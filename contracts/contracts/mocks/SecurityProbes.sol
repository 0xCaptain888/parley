// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract CallbackWallet {
    address public callbackTarget;
    bytes public callbackData;
    bool public reject;
    event CallbackAttempt(bool success, bytes result);

    function configure(address target, bytes calldata data, bool shouldReject) external {
        callbackTarget = target;
        callbackData = data;
        reject = shouldReject;
    }

    function invoke(address target, bytes calldata data) external payable returns (bytes memory result) {
        bool ok;
        (ok, result) = target.call{value: msg.value}(data);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    receive() external payable {
        if (callbackTarget != address(0)) {
            (bool ok, bytes memory result) = callbackTarget.call(callbackData);
            emit CallbackAttempt(ok, result);
        }
        require(!reject, "probe rejects BNB");
    }
}

contract CallbackToken is ERC20 {
    address public callbackTarget;
    bytes public callbackData;
    event CallbackAttempt(bool success, bytes result);

    constructor() ERC20("CALLBACK", "CALLBACK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function invoke(address target, bytes calldata data) external returns (bytes memory result) {
        bool ok;
        (ok, result) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, amount);
        if (from != address(0) && callbackTarget != address(0)) {
            (bool ok, bytes memory result) = callbackTarget.call(callbackData);
            emit CallbackAttempt(ok, result);
        }
    }
}

// A hypothetical registry lifecycle, not a claim about the production registry.
contract RevocableRegistry {
    mapping(bytes32 => address) private _owners;
    mapping(address => uint256) public balanceOf;

    function register(string calldata handle, address owner) external {
        _owners[keccak256(bytes(handle))] = owner;
        balanceOf[owner] = 1;
    }

    function setBalance(address owner, uint256 balance) external {
        balanceOf[owner] = balance;
    }

    function ownerOfHandle(string calldata handle) external view returns (address) {
        return _owners[keccak256(bytes(handle))];
    }
}
