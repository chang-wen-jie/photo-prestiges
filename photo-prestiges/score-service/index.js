require('dotenv').config();
const amqp = require('amqplib');
const mongoose = require('mongoose');
const axios = require('axios');
const Target = require('./models/Target');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const IMAGGA_URL = 'https://api.imagga.com/v2/tags';

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('score-service verbonden met MongoDB'))
    .catch(err => console.error('score-service MongoDB error: ', err));

const Entry = mongoose.model('Entry', new mongoose.Schema({
    score: Number
}, { strict: false }));

async function listenForSubmittedEntries() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();
        const queue = 'entry_submitted';
        await channel.assertQueue(queue, { durable: true });
        console.log("score-service luistert naar entry_submitted...");

        channel.consume(queue, async (msg) => {
            if (msg !== null) {
                const data = JSON.parse(msg.content.toString());

                // placeholder afbeelding -- geen cloud
                try {
                    const target = await Target.findById(data.targetId)
                    if (!target) {
                        console.error("Target niet gevonden voor score berekening...");
                        return channel.ack(msg);
                    }

                    const startTime = new Date(target.createdAt).getTime();
                    const deadlineTime = new Date(target.deadline).getTime();
                    const submitTime = new Date(data.submittedAt).getTime();
                    const totalTimeWindow = deadlineTime - startTime;
                    const timeTaken = submitTime - startTime;

                    let speedBonus = 0;
                    if (timeTaken > 0 && timeTaken <= totalTimeWindow) {
                        const speedRatio = 1 - (timeTaken / totalTimeWindow); 
                        speedBonus = Math.round(speedRatio * 50); 
                    }

                    const imagePlaceholder = 'https://imagga.com/static/images/tagging/wind-farm-538576_640.jpg';
                    const imaggaResponse = await axios.get(`${IMAGGA_URL}?image_url=${encodeURIComponent(placeholderImage)}`, {
                        headers: {
                            'Authorization': 'Basic ' + Buffer.from(`${process.env.IMAGGA_API_KEY}:${process.env.IMAGGA_API_SECRET}`).toString('base64')
                        }
                    });

                    // geen afbeelding om mee te vergelijken dus willekeurige calculatie
                    const tags = imaggaResponse.data.result.tags;
                    const imageMatchPercentage = tags.length > 0 ? tags[0].confidence : 0;
                    const finalScore = Math.round(speedBonus + imageMatchPercentage);

                    await Entry.findByIdAndUpdate(data.entryId, { score: finalScore });
                    console.log(`Score berekend: ${data.entryId}`);
                } catch (apiError) {
                    console.error("score-service API error: ", apiError.message);
                }
                channel.ack(msg);
            }
        });
    } catch (error) {
        console.error("score-service RabbitMQ error: ", error);
        setTimeout(listenForSubmittedEntries, 5000); 
    }
}
listenForSubmittedEntries();