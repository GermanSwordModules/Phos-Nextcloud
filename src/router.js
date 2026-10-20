import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
	{ path: '/', redirect: '/read' },
	{ path: '/read/:module?/:book?/:chapter?', name: 'read', component: () => import('./views/ReadingView.vue') },
	{ path: '/bible/:module?/:book?/:chapter?', name: 'bible', component: () => import('./views/BibleView.vue') },
	{ path: '/library', name: 'library', component: () => import('./views/LibraryView.vue') },
	{ path: '/commentary/:module?/:book?/:chapter?', name: 'commentary', component: () => import('./views/BibleView.vue') },
	{ path: '/dict/:module?/:key(.*)?', name: 'dict', component: () => import('./views/DictView.vue') },
	{ path: '/book/:module?', name: 'book', component: () => import('./views/BookView.vue') },
	{ path: '/search', name: 'search', component: () => import('./views/SearchView.vue') },
	{ path: '/bookmarks', name: 'bookmarks', component: () => import('./views/BookmarksView.vue') },
	{ path: '/notes', name: 'notes', component: () => import('./views/BookmarksView.vue'), props: { notesOnly: true } },
	{ path: '/pads/:label?', name: 'pads', component: () => import('./views/StudyPadsView.vue') },
	{ path: '/plan/:module?', name: 'plan', component: () => import('./views/PlanView.vue') },
	{ path: '/sermons/:id?', name: 'sermons', component: () => import('./views/SermonsView.vue') },
	{ path: '/projects/:id?', name: 'projects', component: () => import('./views/ProjectsView.vue') },
	{ path: '/exegesis/:id', name: 'exegesis', component: () => import('./views/ExegesisView.vue') },
	{ path: '/decks/:id?', name: 'decks', component: () => import('./views/DecksView.vue') },
	{ path: '/ebooks/:ref?', name: 'ebooks', component: () => import('./views/EbooksView.vue') },
	{ path: '/shared', name: 'shared', component: () => import('./views/SharedView.vue') },
	{ path: '/conflicts', name: 'conflicts', component: () => import('./views/ConflictsView.vue') },
	{ path: '/devices', name: 'devices', component: () => import('./views/DevicesView.vue') },
]

export default createRouter({ history: createWebHashHistory(), routes })
