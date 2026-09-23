import { PrismaClient } from '@prisma/client';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

const slugify = (text) => {
  if (!text) return '';
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
};

// Caminhos dos dados e arquivos de mídia estáticos
const SEED_DATA_PATH = path.join(__dirname, '../../data/data.json');
const UPLOADS_SRC = path.join(__dirname, '../../data/uploads');
const NEW_UPLOADS_DEST = path.join(__dirname, './public/uploads');

async function main() {
  console.log('🏁 Iniciando o processo de carga inicial do banco de dados...');

  // 1. Copiar diretório de uploads
  try {
    if (await fs.pathExists(UPLOADS_SRC)) {
      await fs.ensureDir(NEW_UPLOADS_DEST);
      await fs.copy(UPLOADS_SRC, NEW_UPLOADS_DEST);
      console.log('✅ Pasta de uploads copiada com sucesso!');
    } else {
      console.log('⚠️ Pasta de uploads original não encontrada.');
    }
  } catch (error) {
    console.error('❌ Erro ao copiar pasta de uploads:', error);
  }

  // 2. Limpar registros do banco atual
  await prisma.menuLink.deleteMany({});
  await prisma.setting.deleteMany({});
  await prisma.post.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.author.deleteMany({});
  await prisma.tag.deleteMany({});
  console.log('🧹 Tabelas do banco de dados limpas com sucesso.');

  // 3. Ler arquivo JSON de sementes
  if (!(await fs.pathExists(SEED_DATA_PATH))) {
    console.error(`❌ Arquivo de dados não encontrado em: ${SEED_DATA_PATH}`);
    process.exit(1);
  }

  const rawData = await fs.readFile(SEED_DATA_PATH, 'utf-8');
  const seedData = JSON.parse(rawData);

  // 4. Cadastrar Categorias
  const categoryIdMap = {};
  console.log('🌱 Cadastrando Categorias...');
  for (let i = 0; i < seedData.categories.length; i++) {
    const cat = seedData.categories[i];
    const createdCat = await prisma.category.create({
      data: {
        name: cat.name,
        slug: cat.slug || slugify(cat.name),
      },
    });
    const originalId = i + 1;
    categoryIdMap[originalId] = createdCat.id;
  }
  console.log(`✅ Criadas ${seedData.categories.length} Categorias.`);

  // 5. Cadastrar Autores
  const authorIdMap = {};
  console.log('🌱 Cadastrando Autores...');
  for (let i = 0; i < seedData.authors.length; i++) {
    const auth = seedData.authors[i];
    const createdAuth = await prisma.author.create({
      data: {
        name: auth.name,
        slug: auth.slug || slugify(auth.name),
        email: auth.email,
        avatar: `/uploads/${auth.avatar}`,
      },
    });
    const originalId = i + 1;
    authorIdMap[originalId] = createdAuth.id;
  }
  console.log(`✅ Criados ${seedData.authors.length} Autores.`);

  // 6. Cadastrar Tags
  console.log('🌱 Cadastrando Tags...');
  const tagsList = [
    { displayName: 'JavaScript', slug: 'javascript' },
    { displayName: 'Web Development', slug: 'web-development' },
    { displayName: 'React', slug: 'react' },
    { displayName: 'Next.js', slug: 'nextjs' },
    { displayName: 'Node.js', slug: 'nodejs' },
  ];
  const createdTags = [];
  for (const tag of tagsList) {
    const t = await prisma.tag.create({
      data: tag,
    });
    createdTags.push(t);
  }
  console.log(`✅ Criadas ${createdTags.length} Tags.`);

  // 7. Cadastrar Posts (Artigos)
  console.log('🌱 Cadastrando Posts...');
  for (const article of seedData.articles) {
    const mappedAuthorId = authorIdMap[article.author.id];
    const mappedCategoryId = categoryIdMap[article.category.id];
    const randomTags = createdTags.slice(0, Math.floor(Math.random() * 3) + 1);
    const stringifiedContent = JSON.stringify(article.blocks || []);

    await prisma.post.create({
      data: {
        title: article.title,
        slug: article.slug || slugify(article.title),
        excerpt: article.description,
        content: stringifiedContent,
        allowComments: true,
        cover: `/uploads/${article.slug}.jpg`,
        authorId: mappedAuthorId,
        categories: {
          connect: { id: mappedCategoryId },
        },
        tags: {
          connect: randomTags.map((t) => ({ id: t.id })),
        },
      },
    });
  }
  console.log(`✅ Criados ${seedData.articles.length} Posts.`);

  // 8. Cadastrar Configurações Globais (Settings)
  console.log('🌱 Cadastrando Configurações Globais...');
  await prisma.setting.create({
    data: {
      id: 1,
      blogName: seedData.global.siteName,
      blogDescription: seedData.global.siteDescription,
      logo: '/uploads/logo.svg',
      text: seedData.about.title,
      menuLinks: {
        create: [
          { text: 'Home', link: '/', newTab: false },
          { text: 'About', link: '/about', newTab: false },
          { text: 'GitHub', link: 'https://github.com', newTab: true },
        ],
      },
    },
  });
  console.log('✅ Configurações Globais criadas com sucesso.');

  console.log('🎉 Carga inicial finalizada com sucesso!');
}

main()
  .catch((e) => {
    console.error('❌ Erro durante o processo de seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });