const fs = require('fs');
const path = require('path');

const Entry = require('../models/Entry');
const ClosedTarget = require('../models/ClosedTarget');
const { publishEvent } = require('../utils/rabbitmq');

async function submitEntry(userId, targetId, fileUrl) {
    if (!fileUrl) throw new Error("NO_FILE");

    const isClosed = await ClosedTarget.findOne({ targetId });
    if (isClosed) throw new Error("CLOSED");

    const newEntry = new Entry({
        targetId, userId, imageUrl: fileUrl, createdAt: new Date()
    });
    await newEntry.save();

    await publishEvent("entry_submitted", {
        entryId: newEntry._id, 
        targetId: newEntry.targetId,
        imageUrl: newEntry.imageUrl, 
        createdAt: newEntry.createdAt,
    });

    return newEntry;
}

async function deleteEntry(entryId, userId, rootDir) {
    const entry = await Entry.findById(entryId);
    if (!entry) throw new Error("NOT_FOUND");
    if (entry.userId !== userId) throw new Error("UNAUTHORIZED");

    const filePath = path.join(rootDir, entry.imageUrl);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await Entry.findByIdAndDelete(entryId);
}

async function getMyScore(targetId, userId) {
    const entry = await Entry.findOne({ targetId, userId });
    if (!entry) throw new Error("NOT_FOUND");
    return entry.score !== null && entry.score !== undefined ? entry.score : "Score wordt berekend...";
}

async function getAllScores(targetId, userRole) {
    if (userRole !== "owner") throw new Error("UNAUTHORIZED");
    return await Entry.find({ targetId }).select("-imageUrl");
}

module.exports = { submitEntry, deleteEntry, getMyScore, getAllScores };