const nodemailer = require("nodemailer");

async function sendNotificationEmails(participants, type, targetId, timeLeft) {
  if (!participants || participants.length === 0) {
    console.log(`Geen deelnemers gevonden voor target ${targetId}...`);
    return;
  }

  const testAccount = await nodemailer.createTestAccount();
  const transporter = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });

  for (const participant of participants) {
    let subject = "";
    let text = "";
    if (type === "REMINDER") {
      subject = `Target sluit over ${timeLeft}!`;
      text = `Hoi ${participant.userId},\n\nTarget ${targetId} staat open waarvoor je nog geen foto geüpload hebt.\n\nJe hebt nog maar ${timeLeft} de tijd!`;
    } else {
      subject = "Target gesloten, je score is berekend!";
      text = `Hoi ${participant.userId},\n\nDe deadline voor target ${targetId} is verstreken. \n\nJouw score is: ${participant.score} punten!\n\nBedankt voor het spelen!`;
    }

    const info = await transporter.sendMail({
      from: "test@photo-prestiges.com",
      to: participant.email,
      subject: subject,
      text: text,
    });
    console.log(
      `Mail verstuurd naar ${participant.email}: `,
      nodemailer.getTestMessageUrl(info),
    );
  }
}

module.exports = { sendNotificationEmails };
