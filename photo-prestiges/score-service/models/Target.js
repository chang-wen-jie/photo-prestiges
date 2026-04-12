const mongoose = require('mongoose');

const targetSchema = new mongoose.Schema({
    ownerId: { type: String, required: true },
    locationDescription: { type: String, required: true },
    imageUrl: { type: String, required: true },
    deadline: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Target', targetSchema);