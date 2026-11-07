<script lang="ts">
  // autotel logo: the 🔭 emoji. A colour emoji font draws it in its own
  // colours; without one, the glyph takes the text colour, so it follows the
  // theme rather than vanishing on a dark background.
  interface Props {
    fill?: string;
    width?: number;
    height?: number;
    [key: string]: unknown;
  }
  let {
    fill = 'currentColor',
    width = 40,
    height = 40,
    ...rest
  }: Props = $props();
</script>

<svg
  {width}
  {height}
  viewBox="0 0 128 128"
  role="img"
  aria-label="autotel"
  overflow="hidden"
  xmlns="http://www.w3.org/2000/svg"
  {...rest}
>
  <text
    x="50%"
    y="50%"
    transform="translate(0,10)"
    dy="-0.07em"
    text-anchor="middle"
    dominant-baseline="central"
    font-size="114"
    font-family="sans-serif"
    {fill}>🔭</text
  >
</svg>
