require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const amqp = require('amqplib');
const path = require('path');
const fs = require('fs');
const Entry = require('./models/Entry');
const ClosedTarget = require('./models/ClosedTarget');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3004;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('participation-service verbonden met MongoDB'))
    .catch(err => console.error('participation-service MongoDB error: ', err));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `entry_${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

async function listenForReachedDeadlines() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();
        const queue = 'deadline_reached';
        await channel.assertQueue(queue, { durable: true });
        console.log("participation-service luistert naar deadline_reached...");

        channel.consume(queue, async (msg) => {
            if (msg !== null) {
                const data = JSON.parse(msg.content.toString());
                
                await ClosedTarget.updateOne(
                    { targetId: data.targetId },
                    { $set: { targetId: data.targetId } },
                    { upsert: true }
                );
                console.log(`Target gesloten: ${data.targetId}`);
                
                const entries = await Entry.find({ targetId: data.targetId });
                const participantsToMail = entries.map(entry => {
                    return {
                        userId: entry.userId,
                        score: entry.score,
                        email: `${entry.userId}@photo-prestiges.com` // mock e-mailadres
                    };
                });

                const mailQueue = 'send_emails';
                await channel.assertQueue(mailQueue, { durable: true });
                const mailPayload = JSON.stringify({
                    targetId: data.targetId,
                    participants: participantsToMail
                });
                channel.sendToQueue(mailQueue, Buffer.from(mailPayload));
                channel.ack(msg);
            }
        });
    } catch (error) {
        setTimeout(listenForReachedDeadlines, 5000);
    }
}
listenForReachedDeadlines();

async function listenForTriggerReminders() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();
        const reminderQueue = 'trigger_reminders';
        await channel.assertQueue(reminderQueue, { durable: true });
        console.log("participation-service luistert naar trigger_reminders...");

        channel.consume(reminderQueue, async (msg) => {
            if (msg !== null) {
                const data = JSON.parse(msg.content.toString());

                const authUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
                const response = await axios.get(`${authUrl}/internal/users`);
                const allUsers = response.data;

                const entries = await Entry.find({ targetId: data.targetId });
                const submittedUserIds = entries.map(entry => entry.userId);
                const slackers = allUsers.filter(user => !submittedUserIds.includes(user._id.toString()));

                if (slackers.length > 0) {
                    const participantsToMail = slackers.map(user => {
                        return {
                            userId: user.username,
                            email: `${user.username}@photo-prestiges.com` 
                        };
                    });

                    const mailQueue = 'send_emails';
                    await channel.assertQueue(mailQueue, { durable: true });
                    const mailPayload = JSON.stringify({
                        type: 'REMINDER',
                        targetId: data.targetId,
                        timeLeft: data.timeLeft,
                        participants: participantsToMail
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

app.post('/:targetId', upload.single('image'), async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const targetId = req.params.targetId;

        if (!req.file) return res.status(400).json({ error: 'Afbeelding is verplicht' });
        const isClosed = await ClosedTarget.findOne({ targetId: targetId });
        if (isClosed) {
            return res.status(403).json({ error: 'Target deadline is voorbij' });
        }

        const submissionTime = new Date(); 

        const newEntry = new Entry({
            targetId: targetId,
            userId: userId,
            imageUrl: `/uploads/${req.file.filename}`,
            createdAt: submissionTime
        });

        await newEntry.save();

        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();
        const queue = 'entry_submitted';
        
        await channel.assertQueue(queue, { durable: true });
        
        const messagePayload = JSON.stringify({
            entryId: newEntry._id,
            targetId: newEntry.targetId,
            imageUrl: newEntry.imageUrl,
            createdAt: newEntry.createdAt
        });
        
        channel.sendToQueue(queue, Buffer.from(messagePayload));
        setTimeout(() => { connection.close(); }, 500);
        res.status(201).json({ message: 'Entry ingediend', entry: newEntry });

    } catch (error) {
        res.status(500).json({ error: 'Entry indienen mislukt' });
    }
});

app.delete('/:id', async (req, res) => {
    try {
        const entryId = req.params.id;
        const userId = req.headers['x-user-id'];

        const entry = await Entry.findById(entryId);
        if (!entry) {
            return res.status(404).json({ error: 'Entry niet gevonden' });
        }

        if (entry.userId !== userId) {
            return res.status(403).json({ error: 'Niet geauthoriseerd om entry te verwijderen' });
        }

        const filePath = path.join(__dirname, entry.imageUrl);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath); 
        }

        await Entry.findByIdAndDelete(entryId);
        res.status(200).json({ message: 'Entry verwijderd' });

    } catch (error) {
        res.status(500).json({ error: 'Entry verwijderen mislukt' });
    }
});

app.get('/:targetId/my-score', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];

        const entry = await Entry.findOne({ targetId: req.params.targetId, userId: userId });
        if (!entry) {
            return res.status(404).json({ message: 'Geen entry ingediend' });
        }
        
        res.status(200).json({ 
            message: 'Score opgehaald', 
            score: entry.score !== null ? entry.score : 'Score wordt berekend...' 
        });
    } catch (error) {
        res.status(500).json({ error: 'Score ophalen mislukt' });
    }
});

app.get('/:targetId/scores', async (req, res) => {
    try {
        const userRole = req.headers['x-user-role'];
        if (userRole !== 'owner') {
            return res.status(403).json({ error: 'Niet geauthoriseerd om scores op te halen' });
        }

        const entries = await Entry.find({ targetId: req.params.targetId }).select('-imageUrl'); // geheugen besparen
        
        res.status(200).json({
            message: 'PScores opgehaald',
            totalEntries: entries.length,
            entries: entries
        });
    } catch (error) {
        res.status(500).json({ error: 'Scores ophalen mislukt' });
    }
});

app.listen(PORT, () => {
    console.log(`participation-service draait op poort: ${PORT}`);
});