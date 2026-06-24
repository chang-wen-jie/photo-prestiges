require("dotenv").config();

const amqp = require("amqplib");
const express = require("express");

const axios = require("axios");
const mongoose = require("mongoose");
const multer = require("multer");

const fs = require("fs");
const path = require("path");

const Participant = require("./models/Participant");
const Entry = require("./models/Entry");
const ClosedTarget = require("./models/ClosedTarget");
const {
  submitEntry,
  deleteEntry,
  getMyScore,
  getAllScores,
} = require("./services/ParticipationService");

const app = express();
app.use(express.json());

const verifyInternalApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return res
      .status(403)
      .json({ error: "Toegang geweigerd: Ongeldige interne API key" });
  }
  next();
};
app.use(verifyInternalApiKey);

const RABBITMQ_URL = process.env.RABBITMQ_URL;
const PORT = process.env.PORT;
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("3️⃣ participation-service: Verbonden met MongoDB"))
  .catch((err) =>
    console.error("3️⃣ participation-service: MongoDB error: ", err),
  );

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use("/uploads", express.static(uploadDir));
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, `entry_${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage });

async function listenForUserRegistered() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    const userRegisteredQueue = "user_registered";
    await channel.assertQueue(userRegisteredQueue, { durable: true });

    channel.consume(userRegisteredQueue, async (msg) => {
      if (msg !== null) {
        const data = JSON.parse(msg.content.toString());

        await Participant.updateOne(
          { userId: data.userId },
          { $set: { userId: data.userId } },
          { upsert: true },
        );
        channel.ack(msg);
      }
    });
  } catch (error) {
    setTimeout(listenForUserRegistered, 5000);
  }
}
listenForUserRegistered();

async function listenForDeadlineReached() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    const deadlineReachedQueue = "deadline_reached";
    await channel.assertQueue(deadlineReachedQueue, { durable: true });

    channel.consume(deadlineReachedQueue, async (msg) => {
      if (msg !== null) {
        const data = JSON.parse(msg.content.toString());

        await ClosedTarget.updateOne(
          { targetId: data.targetId },
          { $set: { targetId: data.targetId } },
          { upsert: true },
        );
        console.log(`Target gesloten: ${data.targetId}`);

        const entries = await Entry.find({ targetId: data.targetId });
        const participantsToMail = entries.map((entry) => {
          return {
            userId: entry.userId,
            score: entry.score,
            email: `${entry.userId}@photo-prestiges.com`,
          };
        });
        const mailQueue = "send_emails";

        await channel.assertQueue(mailQueue, { durable: true });
        const mailPayload = JSON.stringify({
          targetId: data.targetId,
          participants: participantsToMail,
        });
        channel.sendToQueue(mailQueue, Buffer.from(mailPayload));
        channel.ack(msg);
      }
    });
  } catch (error) {
    setTimeout(listenForDeadlineReached, 5000);
  }
}
listenForDeadlineReached();

async function listenForTriggerReminders() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    const triggerRemaindersQueue = "trigger_reminders";
    await channel.assertQueue(triggerRemaindersQueue, { durable: true });

    channel.consume(triggerRemaindersQueue, async (msg) => {
      if (msg !== null) {
        const data = JSON.parse(msg.content.toString());

        const allParticipants = await Participant.find();
        const entries = await Entry.find({ targetId: data.targetId });
        const submittedUserIds = entries.map((entry) => entry.userId);
        const slackers = allParticipants.filter(
          (p) => !submittedUserIds.includes(p.userId),
        );

        if (slackers.length > 0) {
          const participantsToMail = slackers.map((slacker) => {
            return {
              userId: slacker.userId,
              email: `${slacker.userId}@photo-prestiges.com`,
            };
          });

          const mailQueue = "send_emails";
          await channel.assertQueue(mailQueue, { durable: true });
          const mailPayload = JSON.stringify({
            type: "REMINDER",
            targetId: data.targetId,
            timeLeft: data.timeLeft,
            participants: participantsToMail,
          });

          channel.sendToQueue(mailQueue, Buffer.from(mailPayload));
        }
        channel.ack(msg);
      }
    });
  } catch (error) {
    setTimeout(listenForTriggerReminders, 5000);
  }
}
listenForTriggerReminders();

async function listenForScoreCalculated() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    const scoreCalculatedQueue = "score_calculated";
    await channel.assertQueue(scoreCalculatedQueue, { durable: true });

    channel.consume(scoreCalculatedQueue, async (msg) => {
      if (msg !== null) {
        const data = JSON.parse(msg.content.toString());

        await Entry.findByIdAndUpdate(data.entryId, { score: data.score });
        console.log(`Score opgeslagen voor entry: ${data.entryId}`);

        channel.ack(msg);
      }
    });
  } catch (error) {
    setTimeout(listenForScoreCalculated, 5000);
  }
}
listenForScoreCalculated();

app.post("/:targetId", upload.single("image"), async (req, res) => {
  try {
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const entry = await submitEntry(
      req.headers["x-user-id"],
      req.params.targetId,
      fileUrl,
    );
    res.status(201).json({ message: "Entry ingediend", entry });
  } catch (error) {
    if (error.message === "NO_FILE")
      return res.status(400).json({ error: "Afbeelding is verplicht" });
    if (error.message === "CLOSED")
      return res.status(403).json({ error: "Target deadline is voorbij" });
    res.status(500).json({ error: "Entry indienen mislukt" });
  }
});

app.delete("/:id", async (req, res) => {
  try {
    await deleteEntry(req.params.id, req.headers["x-user-id"], __dirname);
    res.status(200).json({ message: "Entry verwijderd" });
  } catch (error) {
    if (error.message === "NOT_FOUND")
      return res.status(404).json({ error: "Entry niet gevonden" });
    if (error.message === "UNAUTHORIZED")
      return res.status(403).json({ error: "Niet geauthoriseerd" });
    res.status(500).json({ error: "Entry verwijderen mislukt" });
  }
});

app.get("/:targetId/my-score", async (req, res) => {
  try {
    const score = await getMyScore(
      req.params.targetId,
      req.headers["x-user-id"],
    );
    res.status(200).json({ message: "Score opgehaald: ", score });
  } catch (error) {
    if (error.message === "NOT_FOUND")
      return res.status(404).json({ message: "Geen entry ingediend" });
    res.status(500).json({ error: "Score ophalen mislukt" });
  }
});

app.get("/:targetId/scores", async (req, res) => {
  try {
    const entries = await getAllScores(
      req.params.targetId,
      req.headers["x-user-role"],
    );
    res
      .status(200)
      .json({
        message: "Scores opgehaald",
        totalEntries: entries.length,
        entries,
      });
  } catch (error) {
    if (error.message === "UNAUTHORIZED")
      return res.status(403).json({ error: "Niet geauthoriseerd" });
    res.status(500).json({ error: "Scores ophalen mislukt" });
  }
});

app.listen(PORT, () => {
  console.log(`3️⃣ participation-service: Draait op poort ${PORT}`);
});
