require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Target = require('./models/Target');
const amqp = require('amqplib');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('target-service verbonden met MongoDB'))
    .catch(err => console.error('target-service MongoDB error: ', err));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({ // onthou afbeeldingen na service ctrl+c
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `target_${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage: storage });

app.post('/', upload.single('image'), async (req, res) => {
    try {
        const ownerId = req.headers['x-user-id'];
        const userRole = req.headers['x-user-role'];

        if (userRole !== 'owner') {
            return res.status(403).json({ error: 'Alleen owners kunnen targets aanmaken' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'Afbeelding is verplicht' });
        }

        const { locationDescription, deadline } = req.body;

        const newTarget = new Target({
            ownerId: ownerId,
            locationDescription: locationDescription,
            imageUrl: `/uploads/${req.file.filename}`,
            deadline: new Date(deadline)
        });
        await newTarget.save();

        const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
        const channel = await connection.createChannel();
        const queue = 'target_created';
        await channel.assertQueue(queue, { durable: true });
        
        const messagePayload = JSON.stringify({
            targetId: newTarget._id,
            deadline: newTarget.deadline
        });
        
        channel.sendToQueue(queue, Buffer.from(messagePayload));
        setTimeout(() => { connection.close(); }, 500);
        res.status(201).json({ message: 'Target aangemaakt', target: newTarget });
    } catch (error) {
        res.status(500).json({ error: 'Target aanmaken mislukt' });
    }
});

app.get('/', async (req, res) => {
    try {
        const targets = await Target.find();
        res.status(200).json(targets);
    } catch (error) {
        res.status(500).json({ error: 'Targets ophalen mislukt' });
    }
});

app.delete('/:id', async (req, res) => {
    try {
        const targetId = req.params.id;
        const userId = req.headers['x-user-id'];

        const target = await Target.findById(targetId);
        if (!target) {
            return res.status(404).json({ error: 'Target niet gevonden' });
        }

        if (target.ownerId !== userId) {
            return res.status(403).json({ error: 'Niet geauthoriseerd om target te verwijderen' });
        }

        const filePath = path.join(__dirname, target.imageUrl);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath); 
        }

        await Target.findByIdAndDelete(targetId);
        res.status(200).json({ message: 'Target verwijderd' });
    } catch (error) {
        res.status(500).json({ error: 'Target vewrijderen mislukt' });
    }
});

app.listen(PORT, () => {
    console.log(`target-service draait op poort: ${PORT}`);
});