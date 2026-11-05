<?php
/**
 * Anonymous read-only view of a collection shared via a public link
 * (PublicShareController::view). Plain, dependency-free HTML — no Vue
 * bundle, no login, nothing but what $_ hands in. Every value is escaped
 * with htmlspecialchars() directly rather than relying on the layout's p()
 * helper being in scope, since this intentionally doesn't assume anything
 * about how it's wrapped.
 */
function phos_e(string $s): string {
	return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}
$collectionName = isset($_['collectionName']) && is_string($_['collectionName']) ? $_['collectionName'] : 'Phos';
$items = is_array($_['items'] ?? null) ? $_['items'] : [];
?>
<!DOCTYPE html>
<html lang="de">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="robots" content="noindex, nofollow">
	<title><?php echo phos_e($collectionName); ?> &middot; Phos</title>
	<style>
		body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 760px; margin: 0 auto;
			padding: 24px 16px 64px; color: #222; background: #fafafa; }
		h1 { font-size: 1.4em; border-bottom: 1px solid #ddd; padding-bottom: 8px; }
		.hint { color: #666; font-size: 0.9em; margin-top: -8px; }
		.item { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px 20px; margin: 16px 0; }
		.item .kind { display: inline-block; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.03em;
			color: #0082c9; margin-bottom: 4px; }
		.item h2 { font-size: 1.1em; margin: 0 0 8px; }
		.item p { white-space: pre-wrap; margin: 0 0 10px; line-height: 1.5; }
		.empty { color: #666; }
	</style>
</head>
<body>
	<h1><?php echo phos_e($collectionName); ?></h1>
	<p class="hint">Öffentlich geteilt über Phos &mdash; nur zum Lesen.</p>
	<?php if ($items === []): ?>
		<p class="empty">Noch keine Inhalte zum Anzeigen.</p>
	<?php else: foreach ($items as $it): ?>
		<div class="item">
			<span class="kind"><?php echo phos_e((string)($it['typeLabel'] ?? '')); ?></span>
			<h2><?php echo phos_e((string)($it['title'] ?? '')); ?></h2>
			<?php foreach (($it['paragraphs'] ?? []) as $p): ?>
				<p><?php echo phos_e((string)$p); ?></p>
			<?php endforeach; ?>
		</div>
	<?php endforeach; endif; ?>
</body>
</html>
