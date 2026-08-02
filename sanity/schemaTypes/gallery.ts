import { defineField, defineType } from 'sanity'

export default defineType({
  name: 'gallery',
  title: 'Galleri',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Namn (valfritt)',
      type: 'string',
    }),
    defineField({
      name: 'category',
      title: 'Kategori',
      type: 'string',
      options: {
        list: [
          { title: 'Avisteikningar', value: 'avisteikningar' },
          { title: 'Maleriar', value: 'maleriar' },
          { title: 'Barnebøkar', value: 'barnebokar' },
        ],
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'drawing',
      title: 'Bilete',
      type: 'image',
      options: {
        hotspot: true,
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'description',
      title: 'Beskriving (valfritt)',
      type: 'text',
    }),
    defineField({
      name: 'order',
      title: 'Rekkefølgje (valfritt)',
      type: 'number',
      description: 'Lågare tal blir viste først',
    }),
  ],
  preview: {
    select: {
      title: 'title',
      legacyName: 'name',
      media: 'drawing',
      category: 'category',
    },
    prepare(selection) {
      const {title, legacyName, media, category} = selection
      return {
        title: title || legacyName || 'Utan namn',
        subtitle: category,
        media,
      }
    },
  },
})
