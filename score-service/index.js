require("dotenv").config();

const amqp = require("amqplib");
const axios = require("axios");
const mongoose = require("mongoose");

const Target = require("./models/Target");
const { publishEvent } = require("./utils/rabbitmq");

const RABBITMQ_URL = process.env.RABBITMQ_URL;
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("score-service verbonden met MongoDB"))
  .catch((err) => console.error("score-service MongoDB error: ", err));

async function listenForTargetCreated() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    const targetCreatedQueue = "target_created";
    await channel.assertQueue(targetCreatedQueue, { durable: true });

    channel.consume(targetCreatedQueue, async (msg) => {
      if (msg !== null) {
        const data = JSON.parse(msg.content.toString());

        // Sla alleen de datums op die we nodig hebben voor de speed bonus
        await Target.updateOne(
          { targetId: data.targetId },
          {
            $set: {
              targetId: data.targetId,
              deadline: new Date(data.deadline),
              createdAt: new Date(data.createdAt),
            },
          },
          { upsert: true },
        );

        console.log(`Lokale kopie gemaakt van target datums: ${data.targetId}`);
        channel.ack(msg);
      }
    });
  } catch (error) {
    setTimeout(listenForTargetCreated, 5000);
  }
}
listenForTargetCreated();

async function listenForEntrySubmitted() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    const entrySubmittedQueue = "entry_submitted";
    await channel.assertQueue(entrySubmittedQueue, { durable: true });

    channel.consume(entrySubmittedQueue, async (msg) => {
      if (msg !== null) {
        const data = JSON.parse(msg.content.toString());

        // placeholder afbeelding -- geen cloud
        try {
          const target = await Target.findOne({ targetId: data.targetId });
          if (!target) {
            console.error("Target niet gevonden voor score berekening...");
            return channel.ack(msg);
          }

          const startTime = target.createdAt.getTime();
          const deadlineTime = target.deadline.getTime();
          const submitTime = new Date(data.createdAt).getTime();
          const totalTimeWindow = deadlineTime - startTime;
          const timeTaken = submitTime - startTime;
          let speedBonus = 0;
          if (timeTaken > 0 && timeTaken <= totalTimeWindow) {
            const speedRatio = 1 - timeTaken / totalTimeWindow;
            speedBonus = Math.round(speedRatio * 50);
          }

          const imagePlaceholder = process.env.IMAGGA_PLACEHOLDER_IMAGE_URL;
          const imaggaResponse = await axios.get(
            `${process.env.IMAGGA_API_URL}?image_url=${encodeURIComponent(imagePlaceholder)}`,
            {
              headers: {
                Authorization:
                  "Basic " +
                  Buffer.from(
                    `${process.env.IMAGGA_API_KEY}:${process.env.IMAGGA_API_SECRET}`,
                  ).toString("base64"),
              },
            },
          );

          // geen afbeelding om mee te vergelijken dus willekeurige calculatie
          const tags = imaggaResponse.data.result.tags;
          const imageMatchPercentage = tags.length > 0 ? tags[0].confidence : 0;
          const finalScore = Math.round(speedBonus + imageMatchPercentage);

          await publishEvent("score_calculated", {
            entryId: data.entryId,
            score: finalScore,
          });
          console.log(`Score berekend: ${data.entryId}`);
        } catch (apiError) {
          console.error("score-service Immaga API error: ", apiError.message);
        }
        channel.ack(msg);
      }
    });
  } catch (error) {
    console.error("score-service RabbitMQ error: ", error);
    setTimeout(listenForEntrySubmitted, 5000);
  }
}
listenForEntrySubmitted();
