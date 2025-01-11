import app from './app.js';

const PORT = process.env.PORT || 5555;

app.listen(PORT, () => {
      console.log(`Price-researcher rodando porta ${PORT}`);
})