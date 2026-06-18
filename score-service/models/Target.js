const mongoose = require('mongoose');

const targetSchema = new mongoose.Schema({
    targetId: { type: String, required: true, unique: true },
    deadline: Date,
    createdAt: Date
});

module.exports = mongoose.model('Target', targetSchema);