export const toFarsi = (n: string) =>
  n.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[+d])

export const fromFarsi = (s: string) =>
  s
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/٬/g, '')
