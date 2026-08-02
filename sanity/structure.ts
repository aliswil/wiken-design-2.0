import type {StructureResolver} from 'sanity/structure'

const gallerySections = [
  {
    title: 'Avisteikningar',
    category: 'avisteikningar',
    templateId: 'gallery-avisteikningar',
  },
  {
    title: 'Maleriar',
    category: 'maleriar',
    templateId: 'gallery-maleriar',
  },
  {
    title: 'Barnebøkar',
    category: 'barnebokar',
    templateId: 'gallery-barnebokar',
  },
] as const

export const structure: StructureResolver = (S) =>
  S.list()
    .title('Innhald')
    .items(
      gallerySections.map(({title, category, templateId}) =>
        S.listItem()
          .id(category)
          .title(title)
          .child(
            S.documentList()
              .id(`${category}-gallery`)
              .title(title)
              .schemaType('gallery')
              .filter('_type == "gallery" && category == $category')
              .params({category})
              .initialValueTemplates([S.initialValueTemplateItem(templateId)]),
          ),
      ),
    )
