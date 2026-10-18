import axios from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'

const base = path => generateOcsUrl('/apps/phos/api/v1') + path

function fail(e) {
	const err = new Error(e.response?.data?.ocs?.data?.error || e.message)
	err.status = e.response?.status
	err.network = !e.response
	throw err
}

const opts = params => ({ params, headers: { 'OCS-APIRequest': 'true', Accept: 'application/json' } })

/** OCS API of the phos app: resolves to the `data` part of the answer. */
export const http = {
	get: (path, params) => axios.get(base(path), opts(params)).then(r => r.data.ocs.data, fail),
	post: (path, body) => axios.post(base(path), body, opts()).then(r => r.data.ocs.data, fail),
	put: (path, body) => axios.put(base(path), body, opts()).then(r => r.data.ocs.data, fail),
	del: path => axios.delete(base(path), opts()).then(r => r.data.ocs.data, fail),
}
