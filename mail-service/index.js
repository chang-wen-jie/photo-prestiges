require("dotenv").config();

const amqp = require("amqplib");

const { sendNotificationEmails } = require("./services/MailService");

const RABBITMQ_URL = process.env.RABBITMQ_URL;

async function listenForSendEmails() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    const queue = "send_emails";
    await channel.assertQueue(queue, { durable: true });
    console.log("mail-service luisterd naar send_emails...`");

    channel.consume(queue, async (msg) => {
      if (msg !== null) {
        const data = JSON.parse(msg.content.toString());
        await sendNotificationEmails(
          data.participants,
          data.type,
          data.targetId,
          data.timeLeft,
        );
        channel.ack(msg);
      }
    });
  } catch (error) {
    setTimeout(listenForSendEmails, 5000);
  }
}
listenForSendEmails();
