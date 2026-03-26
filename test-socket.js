import { io } from "socket.io-client";

const socket = io("https://stock-war.onrender.com/", { transports: ['websocket'] });

socket.on("connect", () => {
    console.log("Connected to Production Server!");
});

socket.on("initData", (data) => {
    console.log("=== INIT DATA RECEIVED ===");
    console.log(JSON.stringify(data.picks, null, 2));
    socket.disconnect();
    process.exit(0);
});

setTimeout(() => {
    console.error("Timeout: Did not receive initData within 10 seconds.");
    process.exit(1);
}, 10000);
