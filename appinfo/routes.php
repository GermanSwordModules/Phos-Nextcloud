<?php

declare(strict_types=1);

// OCS API, base /ocs/v2.php/apps/phos/api/v1 (docs/protocol.md §7).
return [
	'routes' => [
		// web frontend (hash routing inside)
		['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],
		// files of shared collections, for members (raw bytes, not OCS)
		['name' => 'files#get', 'url' => '/files/{collection}/{path}', 'verb' => 'GET', 'requirements' => ['path' => '.+']],
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
	],
];
