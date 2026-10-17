# Using Tailwind CSS with Angular

Tailwind CSS styles Angular templates through utility classes.

Use Tailwind CSS v4 syntax. Do not add a v3-style `tailwind.config.js` or `@tailwind` directives to this setup; they can break the build.

## Automated setup (recommended)

Add Tailwind CSS with the Angular CLI:

```shell
ng add tailwindcss
```

This will automatically:

1. Install `tailwindcss` and peer dependencies.
2. Configure the project to use Tailwind CSS.
3. Add the proper import to your global styles.

## Manual setup (Tailwind v4)

If setting up manually, use the following Tailwind v4 pattern:

### 1. Install dependencies

Install Tailwind CSS and PostCSS:

```shell
npm install tailwindcss @tailwindcss/postcss postcss
```

### 2. Configure PostCSS

Create a `.postcssrc.json` file in the project root:

```json
{
  "plugins": {
    "@tailwindcss/postcss": {}
  }
}
```

_(Do NOT create a `tailwind.config.js` file! Configuration in v4 is handled through CSS variables)._

### 3. Import Tailwind CSS

In your global styles file (e.g., `src/styles.css`), add the standard v4 import:

```css
@import "tailwindcss";
```

_(If using SCSS, use `@use 'tailwindcss';` instead)._

### 4. Use utility classes

You can now use Tailwind classes directly in your component templates:

```html
<h1 class="text-3xl font-bold underline">Hello world!</h1>
```

## Version rules

- **Do not use `@tailwind base; @tailwind components; @tailwind utilities;`**. Use `@import 'tailwindcss';`.
- **Do not create `tailwind.config.js`**. Configuration is managed directly in CSS via theme variables or using PostCSS configurations.
