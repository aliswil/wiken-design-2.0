import { defineField, defineType } from 'sanity';

export default defineType({
  name: 'gallery',
  title: 'Gallery',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'name',
      title: 'Name',
      type: 'string',
    }),
    defineField({
      name: 'category',
      title: 'Category',
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
      title: 'Drawing/Image',
      type: 'image',
      options: {
        hotspot: true,
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'text',
    }),
    defineField({
      name: 'order',
      title: 'Display Order',
      type: 'number',
      description: 'Lower numbers appear first',
    }),
  ],
  preview: {
    select: {
      title: 'title',
      media: 'drawing',
      category: 'category',
    },
    prepare(selection) {
      const { title, media, category } = selection;
      return {
        title: title,
        subtitle: category,
        media: media,
      };
    },
  },
});
