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
// When looking for an image like /uploads/coffee-art.jpg, it serves it from src/public/uploads
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

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
  const { category, tag, author } = req.query;

  try {
    const where = {};

    if (category) {
      where.categories = { some: { slug: category } };
    }
    if (tag) {
      where.tags = { some: { slug: tag } };
    }
    if (author) {
      where.author = { slug: author };
    }

    const posts = await prisma.post.findMany({
      where,
      include: {
        author: true,
        categories: true,
        tags: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Format the content string back to JSON objects (blocks) if possible
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

// Create a post (Optional dashboard capability)
app.post('/api/posts', async (req, res) => {
  const { title, slug, excerpt, content, allowComments, cover, authorId, categoryIds, tagIds } = req.body;
  try {
    const post = await prisma.post.create({
      data: {
        title,
        slug,
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
        // Tenta buscar por ID numérico; se o seu ID for string (UUID/CUID), remova o Number()
        id: Number(id) || undefined, 
        // Opcional: permite buscar pelo slug caso o parâmetro não seja um número
        slug: isNaN(Number(id)) ? id : undefined,
      },
      data: {
        title,
        slug,
        excerpt,
        content: typeof content === 'string' ? content : JSON.stringify(content),
        allowComments,
        cover,
        authorId,
        // O set: [] limpa as conexões antigas antes de associar as novas
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

    // Formata o conteúdo de volta para JSON para responder ao cliente
    try {
      updatedPost.content = JSON.parse(updatedPost.content);
    } catch (e) {
      // Mantém como string se não for um JSON válido
    }

    res.json(updatedPost);
  } catch (error) {
    res.status(400).json({ error: 'Failed to update post', details: error.message });
  }
});


app.delete('/api/posts/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const deletedPost = await prisma.post.delete({
      where: {
        // Tenta buscar pelo ID numérico
        id: Number(id) || undefined,
        // Caso o parâmetro passado seja o slug em vez de um número
        slug: isNaN(Number(id)) ? id : undefined,
      },
    });

    res.json({ message: 'Post successfully deleted', id: deletedPost.id });
  } catch (error) {
    // Retorna erro caso o post não exista ou ocorra um problema no banco
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

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Node.js Backend listening on http://localhost:${PORT}`);
  console.log(`📁 Uploads available at http://localhost:${PORT}/uploads/`);
});