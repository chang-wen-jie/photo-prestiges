require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('./models/User');

const app = express();
app.use(express.json());

const PORT = process.env.PORT;

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('auth-service verbonden met MongoDB'))
    .catch(err => console.error('auth-service MongoDB error: ', err));

app.post('/register', async (req, res) => {
    try {
        const { username, password, role } = req.body;
        
        const user = new User({ username, password, role });
        await user.save();
        
        res.status(201).json({ message: 'Gebruiker geregistreerd' });
    } catch (error) {
        res.status(500).json({ error: 'Registreren mislukt' });

    }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        
        if (!user || !(await user.comparePassword(password))) {
            return res.status(401).json({ message: 'Ongeldige gegevens' });
        }

        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '2h' }
        );

        res.status(200).json({ message: 'Gebruiker ingelogd', token });
    } catch (error) {
        res.status(500).json({ error: 'Gebruiker inloggen mislukt' });
    }
});

app.get('/internal/users', async (req, res) => {
    try {
        const users = await User.find({ role: 'participant' }).select('-password');
        res.status(200).json(users);
    } catch (error) {
        res.status(500).json({ error: 'Gebruikers ophalen mislukt' });
    }
});

app.listen(PORT, () => {
    console.log(`auth-service draait op poort: ${PORT}`);
});