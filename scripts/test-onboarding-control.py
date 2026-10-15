#!/usr/bin/env python3
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("control_setup", pathlib.Path(__file__).with_name("setup-onboarding-control.py"))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class ControlSetupTests(unittest.TestCase):
    def test_rejects_shell_text_private_endpoints_and_invalid_ports(self):
        for value in ["localhost", "127.0.0.1", "10.0.0.1", "::1", "https://control.example.com", "control.example.com;id", "$(id)", "bad\nname.example.com"]:
            with self.assertRaises(ValueError):
                setup.public_host(value)
        self.assertEqual(setup.public_host("Control.Example.com"), "control.example.com")
        self.assertEqual(setup.public_host("8.8.4.4"), "8.8.4.4")
        for value in ["0", "65536", "-1", "22;id"]:
            with self.assertRaises(ValueError):
                setup.port_number(value)

    def test_subnet_conflict_and_reserved_addresses(self):
        for value in ["192.168.1.1/24", "10.10.0.1/24", "10.0.0.0/24", "10.0.0.255/24", "10.0.0.1/31"]:
            with self.assertRaises(ValueError):
                setup.management_address(value)
        address = setup.management_address("10.253.240.1/24")
        setup.check_routes(address, [{"dst": "default"}, {"dst": "10.253.240.0/24", "dev": "incudal-mgmt"}])
        for destination in ["10.253.0.0/16", "10.253.240.8/32"]:
            with self.assertRaises(ValueError):
                setup.check_routes(address, [{"dst": destination, "dev": "eth0"}])

    def test_env_update_is_idempotent_and_preserves_unrelated_values(self):
        original = "# fixture\nDATABASE_URL=fixture-only\nENCRYPTION_KEY=fixture-only\nONBOARDING_GATEWAY_HOST=old\nONBOARDING_GATEWAY_HOST=duplicate\n"
        values = {"ONBOARDING_GATEWAY_HOST": "127.0.0.1", "ONBOARDING_WG_ENDPOINT": "control.example.com:51820"}
        updated = setup.update_env(original, values)
        self.assertIn("DATABASE_URL=fixture-only\nENCRYPTION_KEY=fixture-only", updated)
        self.assertEqual(updated.count("ONBOARDING_GATEWAY_HOST="), 1)
        self.assertEqual(setup.update_env(updated, values), updated)


if __name__ == "__main__":
    unittest.main()
