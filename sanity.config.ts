'use client'

/**
 * This configuration is used to for the Sanity Studio that’s mounted on the `/app/studio/[[...tool]]/page.tsx` route
 */

import {visionTool} from '@sanity/vision'
import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'

// Go to https://www.sanity.io/docs/api-versioning to learn how API versioning works
import {apiVersion, dataset, projectId} from './sanity/env'
import {schema} from './sanity/schemaTypes'
import {structure} from './sanity/structure'

export default defineConfig({
  basePath: '/studio',
  projectId,
  dataset,
  // Add and edit the content schema in the './sanity/schemaTypes' folder
  schema: {
    ...schema,
    templates: (templates) => [
      ...templates.filter((template) => template.schemaType !== 'gallery'),
      {
        id: 'gallery-avisteikningar',
        title: 'Ny avisteikning',
        schemaType: 'gallery',
        value: {category: 'avisteikningar'},
      },
      {
        id: 'gallery-maleriar',
        title: 'Nytt måleri',
        schemaType: 'gallery',
        value: {category: 'maleriar'},
      },
      {
        id: 'gallery-barnebokar',
        title: 'Nytt barnebokbilete',
        schemaType: 'gallery',
        value: {category: 'barnebokar'},
      },
    ],
  },
  plugins: [
    structureTool({structure}),
    // Vision is for querying with GROQ from inside the Studio
    // https://www.sanity.io/docs/the-vision-plugin
    visionTool({defaultApiVersion: apiVersion}),
  ],
})
