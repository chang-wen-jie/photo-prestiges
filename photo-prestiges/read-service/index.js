require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const Target = require('./models/Target');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3006;

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('read-service verbonden met MongoDB'))
    .catch(err => console.error('read-service MongoDB error: ', err));

app.get('/active-targets', async (req, res) => {
    try {
        const { location } = req.query;
        let query = { deadline: { $gt: new Date() } }; // pre-filter db query

        if (location) {
            query.locationDescription = { $regex: location, $options: 'i' };
        }

        const targets = await Target.find(query);
        res.status(200).json(targets);

    } catch (error) {
        res.status(500).json({ error: 'Gefilterde targets ophalen mislukt' });
    }
});

app.listen(PORT, () => {
    console.log(`read-service draait op poort: ${PORT}`);
});