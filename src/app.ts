import path from "node:path";
import express from "express";
import router from "./routes/router.js";

const app = express();

const publicDir = path.join(process.cwd(), "public");
app.use(express.static(publicDir));
app.use(express.json());

app.use("/api", router);

app.get("/", (_req, res) => {
	res.send(
		"Desenvolvido por João Vitor Gouveia. Linkedin: https://www.linkedin.com/in/jo%C3%A3o-vitor-matos-gouveia-14b71437/",
	);
});

export default app;
