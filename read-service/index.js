require("dotenv").config();

const express = require("express");

const amqp = require("amqplib");
const mongoose = require("mongoose");

const { getActiveTargets } = require('./services/ReadService');

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
  .then(() => console.log("4️⃣ read-service: Verbonden met MongoDB"))
  .catch((err) => console.error("4️⃣ read-service: MongoDB error: ", err));

async function listenForNewTargets() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();
        const targetCreatedQueue = 'target_created';
        await channel.assertQueue(targetCreatedQueue, { durable: true });

        channel.consume(targetCreatedQueue, async (msg) => {
            if (msg !== null) {
                const data = JSON.parse(msg.content.toString());
                
                // Sla een lokale, read-only kopie op in de read-service database
                await Target.updateOne(
                    { targetId: data.targetId }, // Zoek op de originele targetId
                    { 
                        $set: { 
                            targetId: data.targetId,
                            ownerId: data.ownerId,
                            locationDescription: data.locationDescription,
                            imageUrl: data.imageUrl,
                            deadline: new Date(data.deadline),
                            createdAt: new Date(data.createdAt)
                        } 
                    },
                    { upsert: true } // Als hij niet bestaat, maak hem aan
                );
                
                console.log(`Lokale kopie gemaakt van target: ${data.targetId}`);
                channel.ack(msg);
            }
        });
    } catch (error) {
        setTimeout(listenForNewTargets, 5000);
    }
}
listenForNewTargets();

async function listenForDeletedTargets() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();
        const targetDeletedQueue = 'target_deleted';
        await channel.assertQueue(targetDeletedQueue, { durable: true });
        console.log("read-service luistert naar target_deleted...");

        channel.consume(targetDeletedQueue, async (msg) => {
            if (msg !== null) {
                const data = JSON.parse(msg.content.toString());
                
                // Verwijder de lokale kopie als de owner hem verwijdert
                await Target.deleteOne({ targetId: data.targetId });
                
                console.log(`Lokale kopie verwijderd van target: ${data.targetId}`);
                channel.ack(msg);
            }
        });
    } catch (error) {
        setTimeout(listenForDeletedTargets, 5000);
    }
}
listenForDeletedTargets();

app.get("/active-targets", async (req, res) => {
  try {
    const targets = await getActiveTargets(req.query.location);
    res.status(200).json(targets);
  } catch (error) {
    res.status(500).json({ error: "Gefilterde targets ophalen mislukt" });
  }
});

app.listen(PORT, () => {
  console.log(`4️⃣ read-service: Draait op poort ${PORT}`);
});
