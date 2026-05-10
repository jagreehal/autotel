import { defineEcConfig } from '@astrojs/starlight/expressive-code';

export default defineEcConfig({
	styleOverrides: {
		borderRadius: '12px',
		frames: {
			frameBoxShadowCssValue: ({ theme }) =>
				theme.type === 'dark'
					? '0 0 0 1px rgba(255, 255, 255, 0.07), 0 4px 8px rgba(0, 0, 0, 0.28), 0 20px 48px rgba(0, 0, 0, 0.52)'
					: '0 0 0 1px rgba(0, 0, 0, 0.06), 0 2px 6px rgba(0, 0, 0, 0.06), 0 14px 36px rgba(0, 0, 0, 0.11)',
		},
	},
});
