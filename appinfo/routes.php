<?php

declare(strict_types=1);

// OCS API, base /ocs/v2.php/apps/phos/api/v1 (docs/protocol.md §7).
return [
	'routes' => [
		// web frontend (hash routing inside)
		['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],
		// files of shared collections, for members (raw bytes, not OCS)
		['name' => 'files#get', 'url' => '/files/{collection}/{path}', 'verb' => 'GET', 'requirements' => ['path' => '.+']],
		// pictures of books and maps, as their text names them (W-3-B)
		['name' => 'module_file#get', 'url' => '/module/{module}/file', 'verb' => 'GET'],
		// the shared web/facts/ bundle (Phase 3, Scope 1), the app's own static asset
		['name' => 'facts_asset#get', 'url' => '/facts-bundle/{path}', 'verb' => 'GET', 'requirements' => ['path' => '.+']],
		// the shared web/syntax/ bundle (Phase 3, Scope 3), the app's own static asset; the
		// diagram data itself is just a regular 'syntaxDiagram' record, read via /api/v1/changes
		['name' => 'syntax_asset#get', 'url' => '/syntax-bundle/{path}', 'verb' => 'GET', 'requirements' => ['path' => '.+']],
		// the shared web/querybuilder/ bundle (Phase 3, Scope 4), the app's own static asset; the
		// builder only emits a PQL-subset query string, run via the existing reader#search route
		['name' => 'qb_asset#get', 'url' => '/qb-bundle/{path}', 'verb' => 'GET', 'requirements' => ['path' => '.+']],
	],
	'ocs' => [
		['name' => 'api#status', 'url' => '/api/v1/status', 'verb' => 'GET'],
		['name' => 'api#listDevices', 'url' => '/api/v1/devices', 'verb' => 'GET'],
		['name' => 'api#registerDevice', 'url' => '/api/v1/devices', 'verb' => 'POST'],
		['name' => 'api#deleteDevice', 'url' => '/api/v1/devices/{id}', 'verb' => 'DELETE'],
		['name' => 'api#changes', 'url' => '/api/v1/changes', 'verb' => 'GET'],
		['name' => 'api#push', 'url' => '/api/v1/push', 'verb' => 'POST'],
		['name' => 'api#conflicts', 'url' => '/api/v1/conflicts', 'verb' => 'GET'],
		['name' => 'api#resolveConflict', 'url' => '/api/v1/conflicts/{id}/resolve', 'verb' => 'POST'],
		['name' => 'collections#index', 'url' => '/api/v1/collections', 'verb' => 'GET'],
		['name' => 'collections#create', 'url' => '/api/v1/collections', 'verb' => 'POST'],
		['name' => 'collections#update', 'url' => '/api/v1/collections/{collection}', 'verb' => 'PUT'],
		['name' => 'collections#destroy', 'url' => '/api/v1/collections/{collection}', 'verb' => 'DELETE'],
		['name' => 'collections#members', 'url' => '/api/v1/collections/{collection}/members', 'verb' => 'GET'],
		['name' => 'collections#addMember', 'url' => '/api/v1/collections/{collection}/members', 'verb' => 'POST'],
		['name' => 'collections#removeMember', 'url' => '/api/v1/collections/{collection}/members/{type}/{pid}', 'verb' => 'DELETE'],
		['name' => 'collections#sharees', 'url' => '/api/v1/sharees', 'verb' => 'GET'],
		// SWORD reader (W-1)
		['name' => 'reader#modules', 'url' => '/api/v1/modules', 'verb' => 'GET'],
		['name' => 'reader#books', 'url' => '/api/v1/modules/{module}/books', 'verb' => 'GET'],
		['name' => 'reader#chapter', 'url' => '/api/v1/modules/{module}/text/{book}/{chapter}', 'verb' => 'GET'],
		['name' => 'reader#plan', 'url' => '/api/v1/modules/{module}/plan', 'verb' => 'GET'],
		['name' => 'reader#keys', 'url' => '/api/v1/modules/{module}/keys', 'verb' => 'GET'],
		['name' => 'reader#entry', 'url' => '/api/v1/modules/{module}/entry/{key}', 'verb' => 'GET', 'requirements' => ['key' => '.+']],
		['name' => 'reader#toc', 'url' => '/api/v1/modules/{module}/toc', 'verb' => 'GET'],
		['name' => 'reader#sermons', 'url' => '/api/v1/sermons/{book}/{chapter}', 'verb' => 'GET'],
		['name' => 'reader#media', 'url' => '/api/v1/media/{book}/{chapter}', 'verb' => 'GET'],
		['name' => 'reader#search', 'url' => '/api/v1/modules/{module}/search', 'verb' => 'GET'],
		['name' => 'reader#bookEntry', 'url' => '/api/v1/modules/{module}/book', 'verb' => 'GET'],
		// Fakten/Facts (Phase 3, Scope 1)
		['name' => 'facts#topics', 'url' => '/api/v1/facts', 'verb' => 'GET'],
		['name' => 'facts#build', 'url' => '/api/v1/facts/{key}', 'verb' => 'GET', 'requirements' => ['key' => '.+']],
		// phone remote for a deck shown in the web (W-6)
		['name' => 'remote#get', 'url' => '/api/v1/remote', 'verb' => 'GET'],
		['name' => 'remote#command', 'url' => '/api/v1/remote/cmd', 'verb' => 'POST'],
		['name' => 'remote#state', 'url' => '/api/v1/remote/state', 'verb' => 'POST'],
	],
];
