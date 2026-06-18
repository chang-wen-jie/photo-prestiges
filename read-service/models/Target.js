const mongoose = require('mongoose');

const targetSchema = new mongoose.Schema({ // source of truth (target-service)
    targetId: { type: String, required: true, unique: true },
    ownerId: String,
    locationDescription: String,
    imageUrl: String,
    deadline: Date,
    createdAt: Date
});

module.exports = mongoose.model('Target', targetSchema);