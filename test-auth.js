import mongoose from 'mongoose';
async function run() {
    try {
        await mongoose.connect('mongodb+srv://summitplay:wrongpassword@summitplay.i2lkw91.mongodb.net/stockwar?retryWrites=true&w=majority&appName=summitplay');
        console.log("Connected");
    } catch(e) {
        console.error("Error Name:", e.name);
        console.error("Error Message:", e.message);
    }
    process.exit(0);
}
run();
