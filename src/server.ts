import app from "@/app.js";
import { startBumpTopicsScheduler } from "@/infrastructure/background/bump-topics-scheduler.js";
import { startFindNewSuppliersScheduler } from "@/infrastructure/background/find-new-suppliers-scheduler.js";

const PORT = process.env.PORT || 5555;
const SERVER_TIMEOUT_MS = Number(process.env.SERVER_TIMEOUT_MS) || 10 * 60 * 1000; // 10 min

const server = app.listen(PORT, () => {
	console.log(`Price-researcher rodando em: http://localhost:${PORT}`);
	startBumpTopicsScheduler();
	startFindNewSuppliersScheduler();
});

server.setTimeout(SERVER_TIMEOUT_MS);
