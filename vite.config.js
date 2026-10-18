import { createAppConfig } from '@nextcloud/vite-config'

// Builds src/main.js to js/phos-main.mjs (CSS injected by the script).
export default createAppConfig({
	main: 'src/main.js',
}, {
	inlineCSS: true,
	thirdPartyLicense: false,
	extractLicenseInformation: false,
})
