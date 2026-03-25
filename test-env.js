import mongoose from 'mongoose';
const AppStateSchema = new mongoose.Schema({ docId: { type: String, default: 'main' }, scores: Object, picks: Object, chatHistory: Array });
const AppState = mongoose.model('AppState', AppStateSchema);
async function run() {
    try {
        await mongoose.connect('mongodb+srv://summitplay:ab1212%2A%2A@summitplay.i2lkw91.mongodb.net/stockwar?retryWrites=true&w=majority&appName=summitplay');
        let state = await AppState.findOne({ docId: 'main' }).lean();
        console.log(JSON.stringify(state, null, 2));
    } catch(e) {
        console.error("Error:", e.name);
    }
    process.exit(0);
}
run();
