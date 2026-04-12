require('dotenv').config();
const amqp = require('amqplib');
const schedule = require('node-schedule');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

async function listenForTargetCreated() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();
        const targetQueue = 'target_created';
        await channel.assertQueue(targetQueue, { durable: true });
        console.log("clock-service luistert naar target_created...");

        channel.consume(targetQueue, (msg) => {
            if (msg !== null) {
                const targetData = JSON.parse(msg.content.toString());
                const targetDate = new Date(targetData.deadline);

                schedule.scheduleJob(targetDate, async function() {
                    const payload = Buffer.from(JSON.stringify({ targetId: targetData.targetId }));

                    const deadlineQueue = 'deadline_reached';
                    await channel.assertQueue(deadlineQueue, { durable: true });
                    channel.sendToQueue(deadlineQueue, payload);
                    
                    console.log(`Deadline genotificeerd: ${targetData.targetId}`);
                });

                const reminderDate = new Date(targetDate.getTime() - (2 * 60 * 1000))

                if (reminderDate > new Date()) {
                    schedule.scheduleJob(reminderDate, async function() {
                        const payload = Buffer.from(JSON.stringify({ 
                            targetId: targetData.targetId,
                            timeLeft: '2 minuten'
                        }));

                        const reminderQueue = 'trigger_reminders';
                        await channel.assertQueue(reminderQueue, { durable: true });
                        channel.sendToQueue(reminderQueue, payload);

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