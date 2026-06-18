const fs = require("fs");
const path = require("path");

const Target = require("../models/Target");
const { publishEvent } = require("../utils/rabbitmq");

async function createTarget(
  ownerId,
  userRole,
  locationDescription,
  deadline,
  fileUrl,
) {
  if (userRole !== "owner") throw new Error("UNAUTHORIZED");
  if (!fileUrl) throw new Error("NO_FILE");

  const newTarget = new Target({
    ownerId,
    locationDescription,
    imageUrl: fileUrl,
    deadline: new Date(deadline),
  });
  await newTarget.save();

  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();
  const queue = "target_created";

  await channel.assertQueue(queue, { durable: true });
  const messagePayload = JSON.stringify({
    targetId: newTarget._id,
    ownerId: newTarget.ownerId,
    locationDescription: newTarget.locationDescription,
    imageUrl: newTarget.imageUrl,
    deadline: newTarget.deadline,
    createdAt: newTarget._id.getTimestamp(),
  });
  channel.sendToQueue(queue, Buffer.from(messagePayload));
  setTimeout(() => {
    connection.close();
  }, 500);

  return newTarget;
}

async function getAllTargets() {
  return await Target.find();
}

async function deleteTarget(targetId, userId, rootDir) {
  const target = await Target.findById(targetId);
  if (!target) throw new Error("NOT_FOUND");
  if (target.ownerId !== userId) throw new Error("UNAUTHORIZED");

  const filePath = path.join(rootDir, target.imageUrl);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  await Target.findByIdAndDelete(targetId);

  await publishEvent("target_deleted", { targetId: targetId });
}

module.exports = { createTarget, getAllTargets, deleteTarget };
