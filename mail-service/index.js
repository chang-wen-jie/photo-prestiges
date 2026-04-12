require('dotenv').config();
const amqp = require('amqplib');
const nodemailer = require('nodemailer');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

async function listenForSendEmails() {
    try {
        const testAccount = await nodemailer.createTestAccount();
        const transporter = nodemailer.createTransport({
            host: "smtp.ethereal.email", // alleen preview mails
            port: 587,
            secure: false,
            auth: {
                user: testAccount.user, 
                pass: testAccount.pass, 
            },
        });

        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();
        const queue = 'send_emails';
        await channel.assertQueue(queue, { durable: true });
        console.log("mail-service luisterd naar send_emails...`");

        channel.consume(queue, async (msg) => {
            if (msg !== null) {
                const data = JSON.parse(msg.content.toString());

                if (data.participants && data.participants.length > 0) {
                    for (const participant of data.participants) {
                        let subject = "";
                        let text = "";

                        if (data.type === 'REMINDER') {
                            subject = `Target sluit over ${data.timeLeft}!`;
                            text = `Hoi ${participant.userId},\n\nTarget ${data.targetId} staat open waarvoor je nog geen foto geüpload.\n\nJe hebt nog maar ${data.timeLeft} de tijd!`;
                        } else {
                            subject = "Target gesloten, je score is berekend!";
                            text = `Hoi ${participant.userId},\n\nDe deadline voor target ${data.targetId} is verstreken. \n\nJouw score is: ${participant.score} punten!\n\nBedankt voor het spelen!`;
                        }

                        const info = await transporter.sendMail({
                            from: 'test@photo-prestiges.com',
                            to: participant.email,
                            subject: subject,
                            text: text
                        });
                        console.log(`Mail verstuurd naar ${participant.email}: `, nodemailer.getTestMessageUrl(info));
                    }
                } else {
                    console.log(`Geen deelnemers gevonden voor target ${data.targetId}...`);
                }
                channel.ack(msg);
            }
        });
    } catch (error) {
        setTimeout(listenForSendEmails, 5000); 
    }
}
listenForSendEmails();