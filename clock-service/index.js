require("dotenv").config();

const amqp = require("amqplib");
const schedule = require("node-schedule");

const { publishEvent } = require("./utils/rabbitmq");

const RABBITMQ_URL = process.env.RABBITMQ_URL;

async function listenForTargetCreated() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    const targetQueue = "clock_target_created";
    await channel.assertQueue(targetQueue, { durable: true });

    channel.consume(targetQueue, (msg) => {
      if (msg !== null) {
        const targetData = JSON.parse(msg.content.toString());
        const targetDate = new Date(targetData.deadline);

        schedule.scheduleJob(targetDate, async function () {
          await publishEvent("deadline_reached", {
            targetId: targetData.targetId,
          });
          console.log(`Deadline genotificeerd: ${targetData.targetId}`);
        });

        const reminderDate = new Date(targetDate.getTime() - 2 * 60 * 1000);

        if (reminderDate > new Date()) {
          schedule.scheduleJob(reminderDate, async function () {
            await publishEvent("trigger_reminders", {
              targetId: targetData.targetId,
              timeLeft: "2 minuten",
            });
            console.log(`Reminder genotificeerd: ${targetData.targetId}`);
          });
        }
        channel.ack(msg);
      }
    });
  } catch (error) {
    console.error("clock-service RabbitMQ error:", error);
    setTimeout(listenForTargetCreated, 5000);
  }
}
listenForTargetCreated();
