# Wiken Design

Modern portfolio website built with Next.js, TypeScript, Tailwind CSS, and Sanity CMS.

## Getting Started

### 1. Create a Sanity Project

1. Go to [sanity.io](https://www.sanity.io/) and create a new account or login
2. Create a new project
3. Copy your Project ID

### 2. Configure Environment Variables

Update `.env.local` with your Sanity Project ID:

```
NEXT_PUBLIC_SANITY_PROJECT_ID=your-project-id-here
NEXT_PUBLIC_SANITY_DATASET=production
```

Also update `sanity.config.ts` with your Project ID on line 10.

### 3. Install Dependencies

```bash
npm install
```

### 4. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### 5. Access Sanity Studio

Go to [http://localhost:3000/studio](http://localhost:3000/studio) to access the Sanity Studio and add your images.

The first time you access the studio, you'll need to:
1. Login with your Sanity account
2. Add `http://localhost:3000` to your CORS origins in Sanity project settings

### 6. Add Content

In the Sanity Studio:
1. Click "Gallery" in the sidebar
2. Click "Create new document"
3. Fill in:
   - **Title**: Name of the drawing/painting
   - **Category**: Choose from Avisteikningar, Maleriar, or Barnebøkar
   - **Drawing/Image**: Upload your image
   - **Description** (optional): Description of the artwork
   - **Display Order** (optional): Lower numbers appear first
4. Click "Publish"

## Deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

### 2. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign up/login
2. Click "Add New Project"
3. Import your GitHub repository
4. Add environment variables:
   - `NEXT_PUBLIC_SANITY_PROJECT_ID`
   - `NEXT_PUBLIC_SANITY_DATASET`
5. Click "Deploy"

### 3. Configure Custom Domain

1. In your Vercel project, go to Settings → Domains
2. Add `wikendesign.no`
3. Follow Vercel's instructions to update your DNS settings at your domain registrar

### 4. Update Sanity CORS

Add your Vercel domain to allowed origins in Sanity:
1. Go to [sanity.io/manage](https://www.sanity.io/manage)
2. Select your project
3. Go to Settings → API
4. Add your Vercel domain (e.g., `https://wikendesign.no`) to CORS origins

## Project Structure

```
wikendesign-new/
├── app/                    # Next.js app directory
│   ├── avisteikningar/     # Gallery for newspaper drawings
│   ├── maleriar/           # Gallery for paintings
│   ├── barnebokar/         # Gallery for children's books
│   ├── om-meg/             # About page
│   ├── studio/             # Sanity Studio
│   ├── layout.tsx          # Root layout
│   └── page.tsx            # Home page
├── components/             # React components
│   ├── Navbar.tsx
│   ├── Footer.tsx
│   └── GalleryGrid.tsx
├── lib/                    # Utility functions
│   ├── sanity.client.ts    # Sanity client configuration
│   └── sanity.queries.ts   # Sanity data queries
├── sanity/                 # Sanity schemas
│   └── schemas/
│       ├── gallery.ts      # Gallery schema
│       └── index.ts
└── public/                 # Static files (logos, etc.)
```

## Technologies Used

- **Next.js 16** - React framework with App Router
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Sanity v3** - Headless CMS
- **Vercel** - Hosting and deployment
