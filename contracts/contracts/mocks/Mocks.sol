// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockRegistry {
    mapping(address => string) public handleOf;
    mapping(bytes32 => address) private _owner;

    function register(string calldata handle, address to) external {
        require(bytes(handleOf[to]).length == 0, "has handle");
        require(_owner[keccak256(bytes(handle))] == address(0), "taken");
        handleOf[to] = handle;
        _owner[keccak256(bytes(handle))] = to;
    }

    function balanceOf(address a) external view returns (uint256) {
        return bytes(handleOf[a]).length == 0 ? 0 : 1;
    }

    function ownerOfHandle(string calldata handle) external view returns (address) {
        return _owner[keccak256(bytes(handle))];
    }
}

contract MockToken is ERC20 {
    constructor(string memory n) ERC20(n, n) {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

/// 5% fee on every transfer, burned.
contract FeeToken is ERC20 {
    constructor() ERC20("FEE", "FEE") {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 20;
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

interface IParleyLike {
    function openMailbox(bytes32) external;
    function claimPacket(uint256, bytes32) external;
    function withdraw() external;
}

/// An Agent ID holder that is a contract and refuses plain BNB transfers unless told otherwise.
contract PickyWallet {
    bool public accept;

    function setAccept(bool v) external {
        accept = v;
    }

    function open(address p) external {
        IParleyLike(p).openMailbox(bytes32(uint256(1)));
    }

    function claim(address p, uint256 id) external {
        IParleyLike(p).claimPacket(id, bytes32(uint256(1)));
    }

    function pull(address p) external {
        IParleyLike(p).withdraw();
    }

    receive() external payable {
        require(accept, "no");
    }
}

/// Token that tries to re-enter Parley while it is being transferred.
contract ReentrantToken is ERC20 {
    address public target;

    constructor() ERC20("RE", "RE") {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function arm(address t) external {
        target = t;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (target != address(0) && from != address(0)) {
            IParleyLike(target).withdraw();
        }
    }
}
