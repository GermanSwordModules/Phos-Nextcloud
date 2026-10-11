<?php

declare(strict_types=1);

// OCS API, base /ocs/v2.php/apps/phos/api/v1 (docs/protocol.md §7).
return [
	'ocs' => [
		['name' => 'api#status', 'url' => '/api/v1/status', 'verb' => 'GET'],
		['name' => 'api#listDevices', 'url' => '/api/v1/devices', 'verb' => 'GET'],
		['name' => 'api#registerDevice', 'url' => '/api/v1/devices', 'verb' => 'POST'],
		['name' => 'api#deleteDevice', 'url' => '/api/v1/devices/{id}', 'verb' => 'DELETE'],
		['name' => 'api#changes', 'url' => '/api/v1/changes', 'verb' => 'GET'],
		['name' => 'api#push', 'url' => '/api/v1/push', 'verb' => 'POST'],
		['name' => 'api#conflicts', 'url' => '/api/v1/conflicts', 'verb' => 'GET'],
		['name' => 'api#resolveConflict', 'url' => '/api/v1/conflicts/{id}/resolve', 'verb' => 'POST'],
	],
];
