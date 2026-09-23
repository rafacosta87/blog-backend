import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Serve uploaded static files (covers, avatars, etc.)
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Helper function to generate slugs automatically
const slugify = (text) => {
  if (!text) return '';
  return text
    .toString()
    .normalize('NFD') // Divide os acentos das letras (ex: 'é' vira 'e' + '´')
    .replace(/[\u0300-\u036f]/g, '') // Remove todos os acentos isolados
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // Substitui espaços por hifens
    .replace(/[^\w\-]+/g, '') // Remove tudo que não for letra, número ou hífen
    .replace(/\-\-+/g, '-'); // Evita múltiplos hifens seguidos
};

// ===================================
// 1. SETTINGS / GLOBAL ENDPOINT
// ===================================
app.get('/api/settings', async (req, res) => {
  try {
    const setting = await prisma.setting.findUnique({
      where: { id: 1 },
      include: { menuLinks: true },
    });
    if (!setting) {
      return res.status(404).json({ error: 'Settings not found' });
    }
    res.json(setting);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings', details: error.message });
  }
});

// ===================================
// 2. POSTS / ARTICLES ENDPOINTS
// ===================================

// Get all posts (with filtering and pagination optionally)
app.get('/api/posts', async (req, res) => {
  const { category, tag, author, start, limit } = req.query;

  try {
    const where = {};
    if (category) {
      where.categories = { some: { slug: category } };
    }
    if (tag) {
      where.tags = { some: { slug: tag } };
    }
    if (author) {
      where.author = {
        OR: [
          { slug: author },
          { name: { contains: author.replace(/-/g, ' ') } },
        ],
      };
    }

    const posts = await prisma.post.findMany({
      where,
      skip: start ? Number(start) : 0, // Pula os posts que já foram exibidos
      take: limit ? Number(limit) : 6, // Pega os próximos "limit" posts
      include: {
        author: true,
        categories: true,
        tags: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const formattedPosts = posts.map((post) => {
      try {
        return {
          ...post,
          content: JSON.parse(post.content),
        };
      } catch (e) {
        return post;
      }
    });

    res.json(formattedPosts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch posts', details: error.message });
  }
});
// Get single post by slug
app.get('/api/posts/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    const post = await prisma.post.findUnique({
      where: { slug },
      include: {
        author: true,
        categories: true,
        tags: true,
      },
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    try {
      post.content = JSON.parse(post.content);
    } catch (e) {
      // Keep content as string if it's not valid JSON
    }

    res.json(post);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch post', details: error.message });
  }
});

// Create a post (With automatic slug generation from title)
app.post('/api/posts', async (req, res) => {
  const { title, slug, excerpt, content, allowComments, cover, authorId, categoryIds, tagIds } = req.body;
  try {
    const post = await prisma.post.create({
      data: {
        title,
        // Se você não passar um slug no Insomnia, ele gera a partir do title automaticamente!
        slug: slug || slugify(title),
        excerpt,
        content: typeof content === 'string' ? content : JSON.stringify(content),
        allowComments: allowComments ?? true,
        cover,
        authorId,
        categories: categoryIds ? { connect: categoryIds.map((id) => ({ id })) } : undefined,
        tags: tagIds ? { connect: tagIds.map((id) => ({ id })) } : undefined,
      },
      include: {
        author: true,
        categories: true,
        tags: true,
      },
    });
    res.status(201).json(post);
  } catch (error) {
    res.status(400).json({ error: 'Failed to create post', details: error.message });
  }
});

// Update a post by id or slug
app.put('/api/posts/:id', async (req, res) => {
  const { id } = req.params;
  const {
    title,
    slug,
    excerpt,
    content,
    allowComments,
    cover,
    authorId,
    categoryIds,
    tagIds,
  } = req.body;

  try {
    const updatedPost = await prisma.post.update({
      where: { 
        id: Number(id) || undefined, 
        slug: isNaN(Number(id)) ? id : undefined,
      },
      data: {
        title,
        slug: slug || (title ? slugify(title) : undefined),
        excerpt,
        content: typeof content === 'string' ? content : JSON.stringify(content),
        allowComments,
        cover,
        authorId,
        categories: categoryIds 
          ? { set: [], connect: categoryIds.map((catId) => ({ id: catId })) } 
          : undefined,
        tags: tagIds 
          ? { set: [], connect: tagIds.map((tagId) => ({ id: tagId })) } 
          : undefined,
      },
      include: {
        author: true,
        categories: true,
        tags: true,
      },
    });

    try {
      updatedPost.content = JSON.parse(updatedPost.content);
    } catch (e) {
      // Keep as string
    }

    res.json(updatedPost);
  } catch (error) {
    res.status(400).json({ error: 'Failed to update post', details: error.message });
  }
});

// Delete post
app.delete('/api/posts/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const deletedPost = await prisma.post.delete({
      where: {
        id: Number(id) || undefined,
        slug: isNaN(Number(id)) ? id : undefined,
      },
    });
    res.json({ message: 'Post successfully deleted', id: deletedPost.id });
  } catch (error) {
    res.status(404).json({ error: 'Failed to delete post', details: error.message });
  }
});

// ===================================
// 3. CATEGORIES ENDPOINTS
// ===================================
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      include: {
        _count: { select: { posts: true } },
      },
    });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch categories', details: error.message });
  }
});

// Create Category (With automatic slug and id generation)
app.post('/api/categories', async (req, res) => {
  const { name, displayName, slug } = req.body;
  try {
    const finalName = name || displayName; // Garante compatibilidade caso mande de um jeito ou outro
    const category = await prisma.category.create({
      data: {
        name: finalName,
        displayName: displayName || finalName,
        slug: slug || slugify(finalName),
      },
    });
    res.status(201).json(category);
  } catch (error) {
    res.status(400).json({ error: 'Failed to create category', details: error.message });
  }
});

// ===================================
// 4. AUTHORS ENDPOINTS
// ===================================
app.get('/api/authors', async (req, res) => {
  try {
    const authors = await prisma.author.findMany({
      include: {
        _count: { select: { posts: true } },
      },
    });
    res.json(authors);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch authors', details: error.message });
  }
});

// Create Author (With automatic slug generation)
app.post('/api/authors', async (req, res) => {
  const { name, slug, email, avatar } = req.body;
  try {
    if (!name) {
      return res.status(400).json({ error: 'Failed to create author', details: 'Argument `name` is missing.' });
    }
    if (!email) {
      return res.status(400).json({ error: 'Failed to create author', details: 'Argument `email` is missing.' });
    }
    if (!avatar) {
      return res.status(400).json({ error: 'Failed to create author', details: 'Argument `avatar` is missing.' });
    }

    const author = await prisma.author.create({
      data: {
        name,
        slug: slug || slugify(name),
        email,
        avatar,
      },
    });

    res.status(201).json(author);
  } catch (error) {
    res.status(400).json({ error: 'Failed to create author', details: error.message });
  }
});

// ===================================
// 5. TAGS ENDPOINTS
// ===================================
app.get('/api/tags', async (req, res) => {
  try {
    const tags = await prisma.tag.findMany({
      include: {
        _count: { select: { posts: true } },
      },
    });
    res.json(tags);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tags', details: error.message });
  }
});

// Create Tag (With automatic slug and id generation)
app.post('/api/tags', async (req, res) => {
  const { name, displayName, slug } = req.body;
  try {
    const finalName = name || displayName;
    const tag = await prisma.tag.create({
      data: {
        name: finalName,
        displayName: displayName || finalName,
        slug: slug || slugify(finalName),
      },
    });
    res.status(201).json(tag);
  } catch (error) {
    res.status(400).json({ error: 'Failed to create tag', details: error.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Node.js Backend listening on http://localhost:${PORT}`);
  console.log(`📁 Uploads available at http://localhost:${PORT}/uploads/`);
});

