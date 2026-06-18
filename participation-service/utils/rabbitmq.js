const amqp = require("amqplib");

async function publishEvent(queueName, payload) {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();
  await channel.assertQueue(queueName, { durable: true });
  const message = Buffer.from(JSON.stringify(payload));
  channel.sendToQueue(queueName, message);
  setTimeout(() => {
    connection.close();
  }, 500);
}

module.exports = { publishEvent };
