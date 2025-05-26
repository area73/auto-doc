// index.js
const fs = require("fs");
const { Configuration, OpenAIApi } = require("openai");
const { execSync } = require("child_process");
const simpleGit = require("simple-git");

const FILE = "README.md";
const BRANCH_NAME = "auto-doc-update";

const openai = new OpenAIApi(
  new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  })
);

async function improve(content) {
  const res = await openai.createChatCompletion({
    model: "gpt-4",
    messages: [
      { role: "user", content: `Mejora este README.md:\n\n${content}` },
    ],
  });
  return res.data.choices[0].message.content;
}

async function run() {
  const git = simpleGit();

  await git.checkoutLocalBranch(BRANCH_NAME);

  const original = fs.readFileSync(FILE, "utf8");
  const improved = await improve(original);

  if (original === improved) {
    console.log("No hay cambios necesarios");
    return;
  }

  fs.writeFileSync(FILE, improved, "utf8");
  await git.add(FILE);
  await git.commit("Actualización automática del README.md");
  await git.push("origin", BRANCH_NAME);

  const owner = process.env.GITHUB_REPOSITORY.split("/")[0];
  const repo = process.env.GITHUB_REPOSITORY.split("/")[1];

  // Crea el PR vía CLI (mejor en Actions)
  execSync(
    `gh pr create --title "Auto-update README.md" --body "Mejoras automáticas a la documentación." --base main --head ${BRANCH_NAME}`,
    { stdio: "inherit" }
  );
}

run().catch(console.error);
