import { PrismaClient } from '@prisma/client';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

// Paths to find original seed data from Strapi
const STRAPI_DATA_PATH = path.join(__dirname, '../../data/data.json');
const STRAPI_UPLOADS_SRC = path.join(__dirname, '../../data/uploads');
const NEW_UPLOADS_DEST = path.join(__dirname, './public/uploads');

async function main() {
  console.log('🏁 Starting database seed process...');

  // 1. Copy uploads directory
  try {
    if (await fs.pathExists(STRAPI_UPLOADS_SRC)) {
      await fs.ensureDir(NEW_UPLOADS_DEST);
      await fs.copy(STRAPI_UPLOADS_SRC, NEW_UPLOADS_DEST);
      console.log('✅ Uploads folder copied successfully!');
    } else {
      console.log('⚠️ Original uploads folder not found.');
    }
  } catch (error) {
    console.error('❌ Error copying uploads:', error);
  }

  // 2. Clear current database records
  await prisma.menuLink.deleteMany({});
  await prisma.setting.deleteMany({});
  await prisma.post.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.author.deleteMany({});
  await prisma.tag.deleteMany({});
  console.log('🧹 Cleaned database tables.');

  // 3. Read seed JSON file
  if (!(await fs.pathExists(STRAPI_DATA_PATH))) {
    console.error(`❌ Strapi seed data not found at: ${STRAPI_DATA_PATH}`);
    process.exit(1);
  }

  const rawData = await fs.readFile(STRAPI_DATA_PATH, 'utf-8');
  const seedData = JSON.parse(rawData);

  // 4. Seed Categories
  const categoryIdMap = {}; // Maps Strapi ID to our DB ID (though they might align)
  console.log('🌱 Seeding Categories...');
  for (let i = 0; i < seedData.categories.length; i++) {
    const cat = seedData.categories[i];
    // Strapi dummy uses indexes or sequential IDs
    const createdCat = await prisma.category.create({
      data: {
        name: cat.name,
        slug: cat.slug,
      },
    });
    // In Strapi JSON, category reference uses id (1-based index based on position in seed usually)
    const originalId = i + 1;
    categoryIdMap[originalId] = createdCat.id;
  }
  console.log(`✅ Created ${seedData.categories.length} Categories.`);

  // 5. Seed Authors
  const authorIdMap = {};
  console.log('🌱 Seeding Authors...');
  for (let i = 0; i < seedData.authors.length; i++) {
    const auth = seedData.authors[i];
    const createdAuth = await prisma.author.create({
      data: {
        name: auth.name,
        email: auth.email,
        avatar: `/uploads/${auth.avatar}`,
      },
    });
    const originalId = i + 1;
    authorIdMap[originalId] = createdAuth.id;
  }
  console.log(`✅ Created ${seedData.authors.length} Authors.`);

  // 6. Create dummy tags (Strapi's original schema has tags, let's create some based on categories or default ones)
  console.log('🌱 Seeding Tags...');
  const tagsList = [
    { displayName: 'JavaScript', slug: 'javascript' },
    { displayName: 'Web Development', slug: 'web-development' },
    { displayName: 'React', slug: 'react' },
    { displayName: 'Strapi Migration', slug: 'strapi-migration' },
    { displayName: 'Node.js', slug: 'nodejs' },
  ];
  const createdTags = [];
  for (const tag of tagsList) {
    const t = await prisma.tag.create({
      data: tag,
    });
    createdTags.push(t);
  }
  console.log(`✅ Created ${createdTags.length} Tags.`);

  // 7. Seed Posts (Articles)
  console.log('🌱 Seeding Posts...');
  for (const article of seedData.articles) {
    const mappedAuthorId = authorIdMap[article.author.id];
    const mappedCategoryId = categoryIdMap[article.category.id];

    // Find tags to connect (let's connect 1 or 2 random tags to each post)
    const randomTags = createdTags.slice(0, Math.floor(Math.random() * 3) + 1);

    // Format block content into a text string
    const stringifiedContent = JSON.stringify(article.blocks || []);

    await prisma.post.create({
      data: {
        title: article.title,
        slug: article.slug,
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
  console.log(`✅ Created ${seedData.articles.length} Posts.`);

  // 8. Seed Setting (Single Type)
  console.log('🌱 Seeding Settings...');
  const setting = await prisma.setting.create({
    data: {
      id: 1, // enforce single type pattern
      blogName: seedData.global.siteName,
      blogDescription: seedData.global.siteDescription,
      logo: '/uploads/favicon.png',
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
  console.log('✅ Created Global Settings and MenuLinks.');

  console.log('🎉 Seeding successfully completed!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });