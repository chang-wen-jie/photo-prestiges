const mongoose = require('mongoose');

const entrySchema = new mongoose.Schema({
    targetId: { type: String, required: true },
    userId: { type: String, required: true },
    imageUrl: { type: String, required: true },
    score: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Entry', entrySchema);