<?php

declare(strict_types=1);

namespace OCA\Phos\Service\Sword;

/** A module's .conf (sword ConfigEntMgr syntax: [Name], key=value, "\" continues a line). */
final class Conf {
	/** @var array<string, list<string>> */
	private array $entries = [];
	public string $name = '';

	public function __construct(string $text) {
		$lines = preg_split('/\r\n|\r|\n/', $text) ?: [];
		$key = null;
		foreach ($lines as $line) {
			if ($key !== null) {
				// continuation of the previous value
				$cont = str_ends_with($line, '\\');
				$this->append($key, $cont ? substr($line, 0, -1) : $line);
				$key = $cont ? $key : null;
				continue;
			}
			$t = trim($line);
			if ($t === '' || $t[0] === '#') {
				continue;
			}
			if ($t[0] === '[' && str_ends_with($t, ']')) {
				if ($this->name === '') {
					$this->name = substr($t, 1, -1);
				}
				continue;
			}
			$eq = strpos($line, '=');
			if ($eq === false) {
				continue;
			}
			$k = trim(substr($line, 0, $eq));
			$v = ltrim(substr($line, $eq + 1));
			$cont = str_ends_with($v, '\\');
			$this->entries[$k][] = $cont ? substr($v, 0, -1) : rtrim($v);
			$key = $cont ? $k : null;
		}
	}

	private function append(string $key, string $more): void {
		$i = count($this->entries[$key]) - 1;
		$this->entries[$key][$i] .= "\n" . $more;
	}

	public function get(string $key, string $default = ''): string {
		return $this->entries[$key][0] ?? $default;
	}

	/** @return list<string> every value of a repeatable key (Feature, GlobalOptionFilter, …) */
	public function all(string $key): array {
		return $this->entries[$key] ?? [];
	}

	/** DataPath without "./", as stored below the SWORD root. */
	public function dataPath(): string {
		$dp = $this->get('DataPath');
		return str_starts_with($dp, './') ? substr($dp, 2) : $dp;
	}

	public function isUtf8(): bool {
		return strcasecmp($this->get('Encoding'), 'UTF-8') === 0;
	}
}
