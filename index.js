require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Octokit } = require("@octokit/rest");
const simpleGit = require("simple-git");
const { Configuration, OpenAIApi } = require("openai");

const ORG_NAME = "nombre-de-tu-organizacion";
const BRANCH_NAME = "auto-doc-update";
const TMP_DIR = "./tmp";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai = new OpenAIApi(
  new Configuration({ apiKey: process.env.OPENAI_API_KEY })
);

async function getRepos(org) {
  const res = await octokit.repos.listForOrg({
    org,
    type: "all",
    per_page: 100,
  });
  return res.data.map((repo) => repo.full_name);
}

async function improve(content) {
  const res = await openai.createChatCompletion({
    model: "gpt-4",
    messages: [
      { role: "user", content: `Mejora este archivo Markdown:\n\n${content}` },
    ],
  });
  return res.data.choices[0].message.content;
}

async function processRepo(fullName) {
  const [owner, repo] = fullName.split("/");
  const repoDir = path.join(TMP_DIR, repo);

  if (fs.existsSync(repoDir)) fs.rmSync(repoDir, { recursive: true });

  const git = simpleGit();
  await git.clone(
    `https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${owner}/${repo}.git`,
    repoDir
  );

  const filePath = path.join(repoDir, "README.md");
  if (!fs.existsSync(filePath)) {
    console.log(`[${repo}] No README.md`);
    return;
  }

  const original = fs.readFileSync(filePath, "utf8");
  const improved = await improve(original);
  if (original === improved) {
    console.log(`[${repo}] No hay mejoras necesarias.`);
    return;
  }

  const repoGit = simpleGit(repoDir);
  await repoGit.checkoutLocalBranch(BRANCH_NAME);
  fs.writeFileSync(filePath, improved, "utf8");
  await repoGit.add("README.md");
  await repoGit.commit("Mejoras automáticas en README.md");
  await repoGit.push("origin", BRANCH_NAME);

  await octokit.pulls.create({
    owner,
    repo,
    title: "Auto mejora en la documentación",
    head: BRANCH_NAME,
    base: "main",
    body: "Esta PR fue generada automáticamente para mejorar el archivo README.md.",
  });

  console.log(`[${repo}] PR creada.`);
}

async function run() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const repos = await getRepos(ORG_NAME);
  for (const fullName of repos) {
    try {
      await processRepo(fullName);
    } catch (err) {
      console.error(`[${fullName}] Error:`, err.message);
    }
  }
}

run();
