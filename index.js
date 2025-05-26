require("dotenv").config();
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const simpleGit = require("simple-git");
const { Octokit } = require("@octokit/rest");

const TARGET = process.env.TARGET_GITHUB_ACCOUNT; // Puede ser usuario o organización
const TMP_DIR = "./tmp";
const BRANCH_NAME = "auto-doc-update";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getRepos(name) {
  try {
    console.log(`🔍 Buscando repos de la organización "${name}"...`);
    const res = await octokit.repos.listForOrg({
      org: name,
      type: "all",
      per_page: 100,
    });
    return res.data.map((repo) => repo.full_name);
  } catch (err) {
    if (err.status === 404) {
      console.log(
        `🔍 "${name}" no es una organización. Probando como usuario...`
      );
      const res = await octokit.repos.listForUser({
        username: name,
        per_page: 100,
      });
      return res.data.map((repo) => repo.full_name);
    } else {
      throw err;
    }
  }
}

async function improve(content) {
  const prompt = `Mejora la redacción y claridad del siguiente archivo README.md sin cambiar su contenido técnico:\n\n${content}`;
  const res = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: prompt }],
  });
  return res.choices[0].message.content;
}

async function processRepo(fullName) {
  const [owner, repo] = fullName.split("/");
  const repoDir = path.join(TMP_DIR, repo);
  const cloneUrl = `https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${owner}/${repo}.git`;

  if (fs.existsSync(repoDir)) fs.rmSync(repoDir, { recursive: true });

  console.log(`📥 Clonando ${repo}...`);
  await simpleGit().clone(cloneUrl, repoDir);

  const filePath = path.join(repoDir, "README.md");
  if (!fs.existsSync(filePath)) {
    console.log(`📄 [${repo}] No tiene README.md`);
    return;
  }

  const original = fs.readFileSync(filePath, "utf-8");
  const improved = await improve(original);

  if (original.trim() === improved.trim()) {
    console.log(`✅ [${repo}] Sin cambios necesarios.`);
    return;
  }

  const git = simpleGit(repoDir);
  await git.checkoutLocalBranch(BRANCH_NAME);
  fs.writeFileSync(filePath, improved, "utf-8");
  await git.add("README.md");
  await git.commit("Actualización automática del README.md");
  await git.push("origin", BRANCH_NAME);

  console.log(`📤 [${repo}] Enviando Pull Request...`);
  await octokit.pulls.create({
    owner,
    repo,
    title: "Mejoras automáticas en la documentación",
    head: BRANCH_NAME,
    base: "main",
    body: "Este Pull Request ha sido generado automáticamente para mejorar la calidad del README.md.",
  });
}

async function run() {
  if (!TARGET) throw new Error("❌ Falta definir TARGET_GITHUB_ACCOUNT");
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const repos = await getRepos(TARGET);
  console.log(`🔁 Procesando ${repos.length} repos...\n`);

  for (const fullName of repos) {
    try {
      await processRepo(fullName);
    } catch (err) {
      console.error(`❌ Error procesando ${fullName}:`, err.message);
    }
  }
}

run().catch(console.error);
