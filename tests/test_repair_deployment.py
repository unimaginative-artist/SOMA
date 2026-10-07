import base64
import json
import pathlib
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'marionette'))
from repair_deployment import RepairDeployment, sha
import marionette_daemon as md


class RepairDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='soma-deploy-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        (self.root / 'core').mkdir()
        (self.root / 'data').mkdir()
        (self.root / 'data/memory.json').write_text('{"keep":"memory"}')
        (self.root / 'owner.txt').write_text('uncommitted owner edit')
        (self.root / 'package.json').write_text('{"type":"module"}')
        self.before = b'export const value = 1;\n'
        self.after = b'export const value = 2;\n'
        self.target = self.root / 'core/counter.js'
        self.target.write_bytes(self.after)
        self.relative = 'data/self-modification/deployments/test-one/manifest.json'
        manifest = self.root / self.relative
        manifest.parent.mkdir(parents=True)
        manifest.write_text(json.dumps(dict(schema_version=2, promotion_id='test-one', candidate_ref='a'*40,
            test_receipt=dict(passed=True), files=[dict(path='core/counter.js', before_base64=base64.b64encode(self.before).decode(),
                before_sha256=sha(self.before), after_sha256=sha(self.after))])))
        self.contract = RepairDeployment(self.root, self.relative)

    def test_scoped_rollback_preserves_owner_edits_and_persistent_memory(self):
        self.contract.rollback()
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertEqual((self.root / 'owner.txt').read_text(), 'uncommitted owner edit')
        self.assertEqual(json.loads((self.root / 'data/memory.json').read_text()), {'keep': 'memory'})
        self.contract.rollback()  # idempotent recovery after an interrupted daemon

    def test_intervening_target_edit_blocks_rollback(self):
        self.target.write_text('owner changed this after publication')
        with self.assertRaisesRegex(ValueError, 'intervening edit'):
            self.contract.rollback()
        self.assertEqual(self.target.read_text(), 'owner changed this after publication')

    def test_manifest_traversal_and_corrupt_snapshots_are_rejected(self):
        with self.assertRaises(ValueError):
            RepairDeployment(self.root, '../manifest.json')
        manifest = self.contract.manifest
        manifest['files'][0]['before_base64'] = base64.b64encode(b'not the baseline').decode()
        (self.root / self.relative).write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'Corrupt'):
            RepairDeployment(self.root, self.relative)

    def test_no_unscoped_rollback_command_can_be_requested(self):
        supervisor = md.Supervisor()
        self.assertIn('Unscoped', supervisor.request_deploy('soma', 'a'*40)['error'])

    def test_pid_lookup_uses_exact_listener_not_remote_port_or_stale_connection(self):
        table = '\n'.join([
            'TCP 127.0.0.1:3100 127.0.0.1:9000 TIME_WAIT 0',
            'TCP 127.0.0.1:13100 0.0.0.0:0 LISTENING 99',
            'TCP [::]:3100 [::]:0 LISTENING 1234',
        ])
        with patch.object(md.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, table)), patch.object(md, '_ps') as slow_lookup:
            self.assertEqual(md.pid_on_port(3100), 1234)
            slow_lookup.assert_not_called()

    def test_failed_kill_is_not_reported_as_success(self):
        with patch.object(md, 'process_commandline', return_value='node launcher.mjs'), patch.object(md.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1)):
            self.assertFalse(md.kill_pid(123456))

    def test_unknown_pid_with_live_listener_cannot_launch_a_duplicate(self):
        supervisor = md.Supervisor()
        supervisor.alert = lambda *_args, **_kwargs: None
        with patch.object(md, 'pid_on_port', return_value=None), patch.object(md, 'tcp_ok', return_value=True), patch.object(md.subprocess, 'Popen') as launch:
            self.assertIn('error', supervisor.manual_restart('max', 'test'))
            self.assertFalse(supervisor._restart_and_verify(supervisor.monitors['max']))
            launch.assert_not_called()

    def live_server_roundtrip(self, reject_two):
        # Real node processes and real HTTP; only service/PID lookup is replaced
        # to ensure the user's SOMA/MAX processes can never be touched by tests.
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
        script = pathlib.Path(__file__).parent / 'fixtures/repair-canary-server.mjs'
        command = ['node', str(script.resolve()), str(self.root), str(port), str(reject_two).lower()]
        processes = []
        original_popen = subprocess.Popen
        def launch(*args, **kwargs):
            process = original_popen(*args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kwargs)
            processes.append(process)
            return process
        def current_pid(_port):
            return next((p.pid for p in reversed(processes) if p.poll() is None), None)
        def stop(pid):
            process = next(p for p in processes if p.pid == pid)
            process.terminate(); process.wait(timeout=10); return True
        def cleanup():
            for process in processes:
                if process.poll() is None:
                    process.terminate(); process.wait(timeout=10)
        self.addCleanup(cleanup)
        self.target.write_bytes(self.before)
        with patch.object(md.subprocess, 'Popen', side_effect=launch):
            launch(command, cwd=str(self.root))
            url = f'http://127.0.0.1:{port}/health'
            for _ in range(100):
                if md.http_ok(url, 1): break
                time.sleep(.05)
            old_pid = current_pid(port)
            self.target.write_bytes(self.after)
            monitor = md.ServiceMonitor('test', dict(start_dir=str(self.root), start_cmd=command,
                health_url=url, port=port, boot_grace_s=1, detect_file='core/counter.js'))
            supervisor = md.Supervisor()
            supervisor.alert = lambda *_args, **_kwargs: None
            with patch.object(md, 'pid_on_port', side_effect=current_pid), patch.object(md, 'kill_pid', side_effect=stop), patch.dict(md.CONFIG, {'DEPLOY_VERIFY_EXTRA_S': 6}):
                # Interrupted daemon recovery has no caller-supplied Git ref.
                supervisor._managed_deploy(monitor, None, 'isolated integration fixture', self.contract)
            receipt = self.contract.previous_receipt()
            self.assertEqual(receipt['status'], 'rolled_back' if reject_two else 'succeeded', receipt)
            self.assertNotEqual(receipt['pid'], old_pid)
            with urllib.request.urlopen(url, timeout=2) as response:
                result = json.load(response)
            self.assertEqual(result['value'], 1 if reject_two else 2)
            self.assertEqual((self.root / 'data/memory.json').read_text(), '{"keep":"memory"}')
            self.assertEqual((self.root / 'owner.txt').read_text(), 'uncommitted owner edit')

    def test_real_replacement_process_loads_the_candidate(self):
        self.live_server_roundtrip(False)

    def test_real_failed_boot_rolls_back_and_restarts_the_previous_version(self):
        self.live_server_roundtrip(True)

    def test_resume_records_intervening_edit_once_without_restarting(self):
        supervisor = md.Supervisor()
        monitor = supervisor.monitors['soma']
        monitor.spec = {**monitor.spec, 'start_dir': str(self.root)}
        supervisor.alert = lambda *_args, **_kwargs: None
        self.contract.receipt('accepted')
        self.target.write_text('intervening owner change')
        with patch.object(supervisor, '_managed_deploy') as deploy:
            supervisor.resume_deployments()
            supervisor.resume_deployments()
            deploy.assert_not_called()
        self.assertEqual(self.contract.previous_receipt()['status'], 'rollback_blocked')
        self.assertEqual(self.target.read_text(), 'intervening owner change')


if __name__ == '__main__':
    unittest.main()
