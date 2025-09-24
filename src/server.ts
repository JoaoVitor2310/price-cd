import app from "@/app";

const PORT = process.env.PORT || 5555;

app.listen(PORT, () => {
	console.log(`Price-researcher rodando em: http://localhost:${PORT}`);
});
